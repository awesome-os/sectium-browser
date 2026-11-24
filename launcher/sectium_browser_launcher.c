/**
 * @file launcher/sectium_browser_launcher.c
 * @description Zero-dependency native C11 Win64/Linux self-hydrating Sectium Browser launcher
 * with instant (< 15 ms) Lumi White Dragon Hydration Splash, sharing the exact same
 * ~/.b8g/cas/electron/<sha256>/ runtime as awesome-os/code-oss (0 B duplication).
 */

#if !defined(_WIN32) && !defined(_POSIX_C_SOURCE)
  #define _POSIX_C_SOURCE 200809L
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lumi_hydration_splash.h"

#if defined(_WIN32)
  #include <direct.h>
  #include <process.h>
  #define PATH_SEP '\\'
  #define OS_ELECTRON_KEY "electron-win64.tar.zst"
  #define OS_ELECTRON_BIN "electron.exe"
#else
  #include <unistd.h>
  #include <sys/stat.h>
  #include <sys/types.h>
  #define PATH_SEP '/'
  #if defined(__APPLE__) && defined(__aarch64__)
    #define OS_ELECTRON_KEY "electron-macos-arm64.tar.zst"
    #define OS_ELECTRON_BIN "Electron.app/Contents/MacOS/Electron"
  #elif defined(__aarch64__)
    #define OS_ELECTRON_KEY "electron-linux-arm64.tar.zst"
    #define OS_ELECTRON_BIN "electron"
  #else
    #define OS_ELECTRON_KEY "electron-linux-x64.tar.zst"
    #define OS_ELECTRON_BIN "electron"
  #endif
#endif

#define SECTIUM_APP_KEY "sectium-browser-app.tar.zst"
#define SECTIUM_LAUNCHER_VERSION "0.7.2"
#define INDEX_URL "https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json"
#define BLOB_BASE_URL "https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1"
#define MAX_PATH_BUF 1024

static int file_exists(const char *path) {
#if defined(_WIN32)
  DWORD attr = GetFileAttributesA(path);
  return (attr != INVALID_FILE_ATTRIBUTES);
#else
  struct stat st;
  return (stat(path, &st) == 0);
#endif
}

static void mkdir_p(const char *dir) {
  char tmp[MAX_PATH_BUF];
  snprintf(tmp, sizeof(tmp), "%s", dir);
  size_t len = strlen(tmp);
  if (len == 0) return;
  if (tmp[len - 1] == '/' || tmp[len - 1] == '\\') tmp[len - 1] = '\0';
  for (char *p = tmp + 1; *p; p++) {
    if (*p == '/' || *p == '\\') {
      char saved = *p;
      *p = '\0';
#if defined(_WIN32)
      if (!(p - tmp == 2 && tmp[1] == ':')) _mkdir(tmp);
#else
      mkdir(tmp, 0755);
#endif
      *p = saved;
    }
  }
#if defined(_WIN32)
  _mkdir(tmp);
#else
  mkdir(tmp, 0755);
#endif
}

static int get_cas_dir(char *out, size_t cap) {
  const char *env_dir = getenv("B8G_GHOST_CACHE_DIR");
  if (env_dir && env_dir[0] != '\0') {
    snprintf(out, cap, "%s", env_dir);
    return 0;
  }
#if defined(_WIN32)
  const char *home = getenv("USERPROFILE");
  if (!home || home[0] == '\0') home = getenv("HOME");
  if (!home || home[0] == '\0') return -1;
  snprintf(out, cap, "%s\\.b8g\\cas", home);
#else
  const char *home = getenv("HOME");
  if (!home || home[0] == '\0') return -1;
  snprintf(out, cap, "%s/.b8g/cas", home);
#endif
  return 0;
}

static char *read_file_text(const char *path) {
  FILE *fp = fopen(path, "rb");
  if (!fp) return NULL;
  if (fseek(fp, 0, SEEK_END) != 0) {
    fclose(fp);
    return NULL;
  }
  long sz = ftell(fp);
  if (sz <= 0 || sz > 16 * 1024 * 1024) {
    fclose(fp);
    return NULL;
  }
  fseek(fp, 0, SEEK_SET);
  char *buf = (char *)malloc((size_t)sz + 1);
  if (!buf) {
    fclose(fp);
    return NULL;
  }
  size_t n = fread(buf, 1, (size_t)sz, fp);
  buf[n] = '\0';
  fclose(fp);
  return buf;
}

static int lookup_sha256_in_index(const char *json, const char *filename, char out_sha[65]) {
  char key[256];
  snprintf(key, sizeof(key), "\"%s\"", filename);
  const char *pos = strstr(json, key);
  if (!pos) return -1;
  const char *sha_key = strstr(pos, "\"sha256\"");
  if (!sha_key) return -1;
  const char *colon = strchr(sha_key + 8, ':');
  if (!colon) return -1;
  const char *q1 = strchr(colon, '"');
  if (!q1) return -1;
  q1++;
  for (int i = 0; i < 64; i++) {
    char c = q1[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return -1;
    out_sha[i] = (c >= 'A' && c <= 'F') ? (char)(c + 32) : c;
  }
  out_sha[64] = '\0';
  return 0;
}

static void set_env_var(const char *name, const char *value) {
#if defined(_WIN32)
  SetEnvironmentVariableA(name, value);
#else
  if (value) setenv(name, value, 1);
  else unsetenv(name);
#endif
}

static void sanitize_electron_env(void) {
  set_env_var("ELECTRON_RUN_AS_NODE", NULL);
  set_env_var("VSCODE_IPC_HOOK", NULL);
  set_env_var("VSCODE_IPC_HOOK_CLI", NULL);
}

static int refresh_index(const char *cas_dir, const char *index_path) {
  mkdir_p(cas_dir);
  char cmd[MAX_PATH_BUF * 2];
  snprintf(cmd, sizeof(cmd), "curl -fsSL \"%s\" -o \"%s.tmp\"", INDEX_URL, index_path);
  if (system(cmd) != 0) return -1;
  char tmp_path[MAX_PATH_BUF];
  snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", index_path);
#if defined(_WIN32)
  MoveFileExA(tmp_path, index_path, MOVEFILE_REPLACE_EXISTING);
#else
  rename(tmp_path, index_path);
#endif
  return 0;
}

static int hydrate_tar_zst(const char *cas_dir, const char *sha, const char *target_dir) {
  mkdir_p(target_dir);
  char tmp_arc[MAX_PATH_BUF];
  snprintf(tmp_arc, sizeof(tmp_arc), "%s%c%s.tar.zst", cas_dir, PATH_SEP, sha);
  char cmd[MAX_PATH_BUF * 3];
  snprintf(cmd, sizeof(cmd), "curl -fsSL \"%s/%s\" -o \"%s\"", BLOB_BASE_URL, sha, tmp_arc);
  if (system(cmd) != 0) {
    remove(tmp_arc);
    return -1;
  }
#if defined(_WIN32)
  snprintf(cmd, sizeof(cmd), "tar -xf \"%s\" -C \"%s\"", tmp_arc, target_dir);
#else
  snprintf(cmd, sizeof(cmd), "tar --zstd -xf \"%s\" -C \"%s\"", tmp_arc, target_dir);
#endif
  int rc = system(cmd);
  remove(tmp_arc);
  return rc == 0 ? 0 : -1;
}

static int spawn_detached_electron(const char *electron_bin, const char *electron_dir,
                                   const char *app_dir, int argc, char **argv) {
#if defined(_WIN32)
  char cmdline[8192];
  size_t off = (size_t)snprintf(cmdline, sizeof(cmdline), "\"%s\" \"%s\"", electron_bin, app_dir);
  for (int i = 1; i < argc && off + 4 < sizeof(cmdline); i++) {
    if (strcmp(argv[i], "--no-splash") == 0 || strcmp(argv[i], "--dry-run") == 0) continue;
    off += (size_t)snprintf(cmdline + off, sizeof(cmdline) - off, " \"%s\"", argv[i]);
  }
  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.cb = sizeof(si);
  if (!CreateProcessA(electron_bin, cmdline, NULL, NULL, FALSE,
                      DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, NULL,
                      electron_dir, &si, &pi)) {
    return 1;
  }
  CloseHandle(pi.hProcess);
  CloseHandle(pi.hThread);
  return 0;
#else
  const char **child_argv = (const char **)calloc((size_t)argc + 3, sizeof(char *));
  if (!child_argv) return 1;
  int out_i = 0;
  child_argv[out_i++] = electron_bin;
  child_argv[out_i++] = app_dir;
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--no-splash") == 0 || strcmp(argv[i], "--dry-run") == 0) continue;
    child_argv[out_i++] = argv[i];
  }
  child_argv[out_i] = NULL;
  execv(electron_bin, (char *const *)child_argv);
  perror("execv");
  free(child_argv);
  return 127;
#endif
}

int main(int argc, char **argv) {
  int dry_run = 0;
  int no_splash = 0;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--version") == 0 || strcmp(argv[i], "-v") == 0) {
      printf("@awesome-os/sectium-browser %s (electron=%s | app=%s | splash=lumi)\n",
             SECTIUM_LAUNCHER_VERSION, OS_ELECTRON_KEY, SECTIUM_APP_KEY);
      return 0;
    }
    if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
      printf("Sectium Browser %s (Lumi Hydration Splash + shared Electron v47 + b8g-ghost CAS)\n",
             SECTIUM_LAUNCHER_VERSION);
      printf("Usage: sectium-browser [--no-splash] [--dry-run] [--version] [url...]\n");
      return 0;
    }
    if (strcmp(argv[i], "--dry-run") == 0) dry_run = 1;
    if (strcmp(argv[i], "--no-splash") == 0) no_splash = 1;
  }

  sanitize_electron_env();

  char cas_dir[MAX_PATH_BUF];
  if (get_cas_dir(cas_dir, sizeof(cas_dir)) != 0) {
    fprintf(stderr, "[sectium-browser] Could not resolve ~/.b8g/cas\n");
    return 1;
  }

  if (!dry_run && !no_splash) {
    lumi_splash_open("Sectium Browser", "Shared Electron v47 (Chromium 158+)  |  b8g-ghost CAS", "Checking shared Ghost CAS...");
  }

  char index_path[MAX_PATH_BUF];
  snprintf(index_path, sizeof(index_path), "%s%cindex.json", cas_dir, PATH_SEP);

  char electron_sha[65] = {0};
  char app_sha[65] = {0};
  char *json = read_file_text(index_path);
  int found = (json != NULL &&
               lookup_sha256_in_index(json, OS_ELECTRON_KEY, electron_sha) == 0 &&
               lookup_sha256_in_index(json, SECTIUM_APP_KEY, app_sha) == 0);
  if (json) free(json);

  if (!found) {
    if (!dry_run && !no_splash) lumi_splash_set(15, "Refreshing b8g-ghost cas-v1 manifest...");
    if (refresh_index(cas_dir, index_path) != 0) {
      if (!dry_run && !no_splash) lumi_splash_close();
      fprintf(stderr, "[sectium-browser] Failed to fetch cas-v1 index.\n");
      return 1;
    }
    json = read_file_text(index_path);
    found = (json != NULL &&
             lookup_sha256_in_index(json, OS_ELECTRON_KEY, electron_sha) == 0 &&
             lookup_sha256_in_index(json, SECTIUM_APP_KEY, app_sha) == 0);
    if (json) free(json);
    if (!found) {
      if (!dry_run && !no_splash) lumi_splash_close();
      fprintf(stderr, "[sectium-browser] Missing %s or %s in cas-v1 index.\n", OS_ELECTRON_KEY, SECTIUM_APP_KEY);
      return 1;
    }
  }

  char electron_dir[MAX_PATH_BUF];
  char electron_bin[MAX_PATH_BUF];
  char app_dir[MAX_PATH_BUF];
  char app_main[MAX_PATH_BUF];

  snprintf(electron_dir, sizeof(electron_dir), "%s%celectron%c%s", cas_dir, PATH_SEP, PATH_SEP, electron_sha);
  snprintf(electron_bin, sizeof(electron_bin), "%s%c%s", electron_dir, PATH_SEP, OS_ELECTRON_BIN);
  snprintf(app_dir, sizeof(app_dir), "%s%csectium-browser%c%s", cas_dir, PATH_SEP, PATH_SEP, app_sha);
  snprintf(app_main, sizeof(app_main), "%s%cmain.js", app_dir, PATH_SEP);

  if (!file_exists(electron_bin)) {
    if (!dry_run && !no_splash) lumi_splash_set(35, "Hydrating shared Electron v47 runtime...");
    if (hydrate_tar_zst(cas_dir, electron_sha, electron_dir) != 0 || !file_exists(electron_bin)) {
      if (!dry_run && !no_splash) lumi_splash_close();
      fprintf(stderr, "[sectium-browser] Failed to hydrate shared Electron (%s)\n", electron_sha);
      return 1;
    }
  }

  if (!file_exists(app_main)) {
    if (!dry_run && !no_splash) lumi_splash_set(75, "Hydrating Sectium Browser Canvas shell...");
    if (hydrate_tar_zst(cas_dir, app_sha, app_dir) != 0 || !file_exists(app_main)) {
      if (!dry_run && !no_splash) lumi_splash_close();
      fprintf(stderr, "[sectium-browser] Failed to hydrate Sectium app (%s)\n", app_sha);
      return 1;
    }
  }

  if (dry_run) {
    printf("sectium-browser dry-run OK:\n  electron=%s\n  app=%s\n", electron_bin, app_dir);
    return 0;
  }

  set_env_var("B8G_GHOST_CAS_DIR", cas_dir);
  if (!no_splash) lumi_splash_set(92, "Launching Sectium Browser (0 B dup Chromium)...");
  int rc = spawn_detached_electron(electron_bin, electron_dir, app_dir, argc, argv);
  if (!no_splash) {
    lumi_splash_set(100, rc == 0 ? "Sectium Browser launched!" : "Launch failed");
#if defined(_WIN32)
    Sleep(900);
#endif
    lumi_splash_close();
  }
  return rc;
}
