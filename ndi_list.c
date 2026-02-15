#define PROCESSINGNDILIB_STATIC
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <Processing.NDI.Lib.h>

static void json_escape_and_print(const char* value) {
    if (!value) return;

    const unsigned char* p = (const unsigned char*)value;
    while (*p) {
        switch (*p) {
            case '"':
                fputs("\\\"", stdout);
                break;
            case '\\':
                fputs("\\\\", stdout);
                break;
            case '\b':
                fputs("\\b", stdout);
                break;
            case '\f':
                fputs("\\f", stdout);
                break;
            case '\n':
                fputs("\\n", stdout);
                break;
            case '\r':
                fputs("\\r", stdout);
                break;
            case '\t':
                fputs("\\t", stdout);
                break;
            default:
                if (*p < 0x20) {
                    fprintf(stdout, "\\u%04x", *p);
                } else {
                    fputc(*p, stdout);
                }
                break;
        }
        p++;
    }
}

int main() {
    if (!NDIlib_initialize()) {
        fprintf(stderr, "{\"error\":\"NDI initialization failed\"}\n");
        return 1;
    }

    NDIlib_find_create_t find_create = {0};
    find_create.show_local_sources = true;
    NDIlib_find_instance_t finder = NDIlib_find_create_v2(&find_create);
    
    if (!finder) {
        fprintf(stderr, "{\"error\":\"Failed to create finder\"}\n");
        NDIlib_destroy();
        return 1;
    }

    // Wait for sources
    NDIlib_find_wait_for_sources(finder, 2000);
    
    uint32_t num_sources = 0;
    const NDIlib_source_t* sources = NDIlib_find_get_sources(finder, &num_sources, 0);
    
    // Output JSON
    printf("{\"sources\":[");
    for (uint32_t i = 0; i < num_sources; i++) {
        if (i > 0) printf(",");
        printf("{\"name\":\"");
        json_escape_and_print(sources[i].p_ndi_name);
        printf("\"");
        if (sources[i].p_url_address) {
            printf(",\"url\":\"");
            json_escape_and_print(sources[i].p_url_address);
            printf("\"");
        }
        printf("}");
    }
    printf("]}\n");
    
    NDIlib_find_destroy(finder);
    NDIlib_destroy();
    return 0;
}
