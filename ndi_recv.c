#define PROCESSINGNDILIB_STATIC
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>
#include <ctype.h>
#if defined(_WIN32)
#include <windows.h>
#else
#include <unistd.h>
#endif
#include <Processing.NDI.Lib.h>

static void sleep_ms(int ms) {
#if defined(_WIN32)
    Sleep(ms);
#else
    usleep((useconds_t)ms * 1000);
#endif
}

static bool contains_case_insensitive(const char* haystack, const char* needle) {
    if (!haystack || !needle) return false;
    size_t needle_len = strlen(needle);
    if (needle_len == 0) return true;

    for (const char* p = haystack; *p; p++) {
        size_t i = 0;
        while (i < needle_len && p[i] && tolower((unsigned char)p[i]) == tolower((unsigned char)needle[i])) {
            i++;
        }
        if (i == needle_len) return true;
    }

    return false;
}

static inline bool fourcc_equals(NDIlib_FourCC_video_type_e fourcc, const char a, const char b, const char c, const char d) {
    return ((char)((fourcc >> 0) & 0xFF) == a) &&
           ((char)((fourcc >> 8) & 0xFF) == b) &&
           ((char)((fourcc >> 16) & 0xFF) == c) &&
           ((char)((fourcc >> 24) & 0xFF) == d);
}

static int bytes_per_pixel_from_fourcc(NDIlib_FourCC_video_type_e fourcc) {
    if (fourcc_equals(fourcc, 'U', 'Y', 'V', 'Y')) return 2;
    if (fourcc_equals(fourcc, 'B', 'G', 'R', 'A')) return 4;
    if (fourcc_equals(fourcc, 'B', 'G', 'R', 'X')) return 4;
    if (fourcc_equals(fourcc, 'R', 'G', 'B', 'A')) return 4;
    if (fourcc_equals(fourcc, 'R', 'G', 'B', 'X')) return 4;
    if (fourcc_equals(fourcc, 'A', 'R', 'G', 'B')) return 4;
    if (fourcc_equals(fourcc, 'A', 'B', 'G', 'R')) return 4;
    return 0;
}

int main(int argc, char* argv[]) {
    const char* source_name = "MAXNDIStream";
    if (argc > 1) source_name = argv[1];

    // Initialize NDI
    if (!NDIlib_initialize()) {
        fprintf(stderr, "[ndi_recv] NDIlib_initialize failed\n");
        return 1;
    }

    fprintf(stderr, "[ndi_recv] NDI SDK loaded OK\n");
    fprintf(stderr, "[ndi_recv] Looking for source: %s\n", source_name);

    // Create a finder to locate NDI sources
    NDIlib_find_create_t find_create = {0};
    find_create.show_local_sources = true;
    find_create.p_groups = NULL;
    find_create.p_extra_ips = NULL;
    NDIlib_find_instance_t finder = NDIlib_find_create_v2(&find_create);
    if (!finder) {
        fprintf(stderr, "[ndi_recv] Failed to create finder\n");
        NDIlib_destroy();
        return 1;
    }

    NDIlib_source_t* source = NULL;
    NDIlib_source_t found_source;
    for (int attempt = 0; attempt < 20; attempt++) {
        NDIlib_find_wait_for_sources(finder, 3000);
        uint32_t num_sources = 0;
        const NDIlib_source_t* sources = NDIlib_find_get_sources(finder, &num_sources, 0);
        fprintf(stderr, "[ndi_recv] Found %u source(s)\n", num_sources);
        for (uint32_t i = 0; i < num_sources; i++) {
            fprintf(stderr, "[ndi_recv]   - %s\n", sources[i].p_ndi_name);
            // Case-insensitive search
            if (contains_case_insensitive(sources[i].p_ndi_name, source_name)) {
                // Copy the source data since it may become invalid
                found_source = sources[i];
                source = &found_source;
                break;
            }
        }
        if (source) break;
        fprintf(stderr, "[ndi_recv] Source not found yet, waiting...\n");
        sleep_ms(2000);
    }

    if (!source) {
        fprintf(stderr, "[ndi_recv] Source '%s' not found\n", source_name);
        NDIlib_find_destroy(finder);
        NDIlib_destroy();
        return 1;
    }

    fprintf(stderr, "[ndi_recv] Connected to: %s\n", source->p_ndi_name);

    // Create receiver
    NDIlib_recv_create_v3_t recv_create = {0};
    recv_create.source_to_connect_to = *source;
    recv_create.bandwidth = NDIlib_recv_bandwidth_highest;
    recv_create.color_format = NDIlib_recv_color_format_UYVY_BGRA;
    
    NDIlib_recv_instance_t receiver = NDIlib_recv_create_v3(&recv_create);
    if (!receiver) {
        fprintf(stderr, "[ndi_recv] Failed to create receiver\n");
        NDIlib_find_destroy(finder);
        NDIlib_destroy();
        return 1;
    }

    bool first_frame = true;
    int frame_count = 0;
    while (1) {
        NDIlib_video_frame_v2_t video_frame;
        NDIlib_frame_type_e frame_type = NDIlib_recv_capture_v2(receiver, &video_frame, NULL, NULL, 1000);
        if (frame_type == NDIlib_frame_type_video) {
            if (first_frame) {
                fprintf(stderr, "[ndi_recv] VIDEO %dx%d fps=%.2f fourcc=%c%c%c%c\n",
                    video_frame.xres, video_frame.yres,
                    (double)video_frame.frame_rate_N / video_frame.frame_rate_D,
                    (char)((video_frame.FourCC >> 0) & 0xFF),
                    (char)((video_frame.FourCC >> 8) & 0xFF),
                    (char)((video_frame.FourCC >> 16) & 0xFF),
                    (char)((video_frame.FourCC >> 24) & 0xFF));
                first_frame = false;
            }
            int bytes_per_pixel = bytes_per_pixel_from_fourcc(video_frame.FourCC);
            if (bytes_per_pixel == 0) {
                fprintf(stderr, "[ndi_recv] Unsupported FourCC - skipping frame\n");
                NDIlib_recv_free_video_v2(receiver, &video_frame);
                continue;
            }

            // Normalize to tightly-packed output regardless of source stride.
            size_t row_bytes = (size_t)video_frame.xres * (size_t)bytes_per_pixel;
            int stride = video_frame.line_stride_in_bytes;
            size_t written = 0;

            if (stride == (int)row_bytes) {
                size_t frame_size = row_bytes * (size_t)video_frame.yres;
                written = fwrite(video_frame.p_data, 1, frame_size, stdout);
                if (written != frame_size) {
                    fprintf(stderr, "[ndi_recv] pipe closed\n");
                    NDIlib_recv_free_video_v2(receiver, &video_frame);
                    break;
                }
            } else {
                const uint8_t* row_ptr = video_frame.p_data;
                for (int y = 0; y < video_frame.yres; y++) {
                    size_t row_written = fwrite(row_ptr, 1, row_bytes, stdout);
                    if (row_written != row_bytes) {
                        fprintf(stderr, "[ndi_recv] pipe closed\n");
                        written = 0;
                        break;
                    }
                    row_ptr += stride;
                    written += row_written;
                }
                if (written != row_bytes * (size_t)video_frame.yres) {
                    NDIlib_recv_free_video_v2(receiver, &video_frame);
                    break;
                }
            }

            NDIlib_recv_free_video_v2(receiver, &video_frame);
            frame_count++;
        } else if (frame_type == NDIlib_frame_type_none) {
            continue;
        } else if (frame_type == NDIlib_frame_type_metadata) {
            fprintf(stderr, "[ndi_recv] Received metadata (may indicate format change)\n");
        }
    }

    NDIlib_recv_destroy(receiver);
    NDIlib_find_destroy(finder);
    NDIlib_destroy();
    return 0;
}
