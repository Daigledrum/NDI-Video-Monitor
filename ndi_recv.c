#define PROCESSINGNDILIB_STATIC
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <unistd.h>
#include "/Library/NDI SDK for Apple/include/Processing.NDI.Lib.h"

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
            if (strcasestr(sources[i].p_ndi_name, source_name)) {
                // Copy the source data since it may become invalid
                found_source = sources[i];
                source = &found_source;
                break;
            }
        }
        if (source) break;
        fprintf(stderr, "[ndi_recv] Source not found yet, waiting...\n");
        sleep(2);
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
    while (1) {
        NDIlib_video_frame_v2_t video_frame;
        NDIlib_frame_type_e frame_type = NDIlib_recv_capture_v2(receiver, &video_frame, NULL, NULL, 1000);
        if (frame_type == NDIlib_frame_type_video) {
            if (first_frame) {
                fprintf(stderr, "[ndi_recv] VIDEO %dx%d fps=%.2f\n",
                    video_frame.xres, video_frame.yres,
                    (double)video_frame.frame_rate_N / video_frame.frame_rate_D);
                first_frame = false;
            }
            size_t frame_size = (size_t)video_frame.xres * video_frame.yres * 2;
            size_t written = fwrite(video_frame.p_data, 1, frame_size, stdout);
            if (written != frame_size) {
                fprintf(stderr, "[ndi_recv] pipe closed\n");
                break;
            }
            NDIlib_recv_free_video_v2(receiver, &video_frame);
        } else if (frame_type == NDIlib_frame_type_none) {
            continue;
        }
    }

    NDIlib_recv_destroy(receiver);
    NDIlib_find_destroy(finder);
    NDIlib_destroy();
    return 0;
}
