/**
 * @file src/lumi_hydration_splash.h
 * @description Reusable zero-dependency Lumi Hydration Splash Window (Win32 GDI + POSIX ANSI fallback).
 * Gives humans instant (< 15 ms) optical feedback with the embedded Lumi White Dragon icon (ID 101),
 * live hydration status text, and a smooth 0..100% progress bar while b8g-ghost CAS hydrates or launches.
 */

#ifndef LUMI_HYDRATION_SPLASH_H
#define LUMI_HYDRATION_SPLASH_H

#include <stdio.h>
#include <string.h>

#if defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#define LUMI_WM_UPDATE (WM_APP + 42)
#define LUMI_WM_CLOSE  (WM_APP + 43)

typedef struct {
  volatile HWND hwnd;
  HANDLE thread;
  HANDLE ready_event;
  CRITICAL_SECTION lock;
  int initialized;
  int percent;
  char title[128];
  char subtitle[128];
  char status[256];
} lumi_splash_state_t;

static lumi_splash_state_t g_lumi_splash = {0};

static void lumi_splash_paint(HWND hwnd) {
  PAINTSTRUCT ps;
  HDC hdc = BeginPaint(hwnd, &ps);
  RECT rc;
  GetClientRect(hwnd, &rc);

  /* Double-buffer to avoid flicker */
  HDC mem = CreateCompatibleDC(hdc);
  HBITMAP bmp = CreateCompatibleBitmap(hdc, rc.right, rc.bottom);
  HGDIOBJ old_bmp = SelectObject(mem, bmp);

  /* Dark obsidian background + subtle violet border */
  HBRUSH bg = CreateSolidBrush(RGB(13, 17, 26));
  FillRect(mem, &rc, bg);
  DeleteObject(bg);

  HPEN border_pen = CreatePen(PS_SOLID, 2, RGB(88, 101, 242));
  HGDIOBJ old_pen = SelectObject(mem, border_pen);
  HGDIOBJ old_brush = SelectObject(mem, GetStockObject(NULL_BRUSH));
  Rectangle(mem, 1, 1, rc.right - 1, rc.bottom - 1);
  SelectObject(mem, old_brush);
  SelectObject(mem, old_pen);
  DeleteObject(border_pen);

  /* Top accent strip */
  RECT accent = {2, 2, rc.right - 2, 6};
  HBRUSH accent_br = CreateSolidBrush(RGB(56, 189, 248));
  FillRect(mem, &accent, accent_br);
  DeleteObject(accent_br);

  /* Embedded Lumi White Dragon icon (resource ID 101) */
  HICON hIcon = (HICON)LoadImageA(GetModuleHandleA(NULL), MAKEINTRESOURCEA(101), IMAGE_ICON, 64, 64, 0);
  if (hIcon) {
    DrawIconEx(mem, 24, 34, hIcon, 64, 64, 0, NULL, DI_NORMAL);
    DestroyIcon(hIcon);
  }

  /* Snapshot state under lock */
  char title[128], subtitle[128], status[256];
  int pct = 0;
  EnterCriticalSection(&g_lumi_splash.lock);
  snprintf(title, sizeof(title), "%s", g_lumi_splash.title);
  snprintf(subtitle, sizeof(subtitle), "%s", g_lumi_splash.subtitle);
  snprintf(status, sizeof(status), "%s", g_lumi_splash.status);
  pct = g_lumi_splash.percent;
  LeaveCriticalSection(&g_lumi_splash.lock);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  SetBkMode(mem, TRANSPARENT);

  /* Title */
  HFONT f_title = CreateFontA(-22, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                              DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                              CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, "Segoe UI");
  HGDIOBJ old_font = SelectObject(mem, f_title);
  SetTextColor(mem, RGB(241, 245, 249));
  RECT r_title = {104, 30, rc.right - 24, 60};
  DrawTextA(mem, title, -1, &r_title, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

  /* Subtitle */
  HFONT f_sub = CreateFontA(-13, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                            DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                            CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, "Segoe UI");
  SelectObject(mem, f_sub);
  SetTextColor(mem, RGB(148, 163, 184));
  RECT r_sub = {104, 62, rc.right - 24, 84};
  DrawTextA(mem, subtitle, -1, &r_sub, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

  /* Live hydration status text */
  HFONT f_stat = CreateFontA(-14, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE,
                             DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                             CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, "Segoe UI");
  SelectObject(mem, f_stat);
  SetTextColor(mem, RGB(226, 232, 240));
  RECT r_stat = {24, 122, rc.right - 74, 146};
  DrawTextA(mem, status, -1, &r_stat, DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS);

  /* Percentage label */
  char pct_txt[16];
  snprintf(pct_txt, sizeof(pct_txt), "%d%%", pct);
  SetTextColor(mem, RGB(56, 189, 248));
  RECT r_pct = {rc.right - 72, 122, rc.right - 24, 146};
  DrawTextA(mem, pct_txt, -1, &r_pct, DT_RIGHT | DT_SINGLELINE);

  /* Progress bar track */
  int bar_x = 24, bar_y = 156, bar_w = rc.right - 48, bar_h = 14;
  RECT r_track = {bar_x, bar_y, bar_x + bar_w, bar_y + bar_h};
  HBRUSH track_br = CreateSolidBrush(RGB(30, 41, 59));
  FillRect(mem, &r_track, track_br);
  DeleteObject(track_br);

  /* Progress bar fill */
  int fill_w = (bar_w * pct) / 100;
  if (fill_w > 0) {
    RECT r_fill = {bar_x, bar_y, bar_x + fill_w, bar_y + bar_h};
    HBRUSH fill_br = CreateSolidBrush(pct >= 100 ? RGB(52, 211, 153) : RGB(56, 189, 248));
    FillRect(mem, &r_fill, fill_br);
    DeleteObject(fill_br);
  }

  /* Footer hint */
  SelectObject(mem, f_sub);
  SetTextColor(mem, RGB(100, 116, 139));
  RECT r_foot = {24, 180, rc.right - 24, 200};
  DrawTextA(mem, "Shared Ghost CAS (~/.b8g/cas)  |  Zero-Duplication Hydration", -1, &r_foot, DT_LEFT | DT_SINGLELINE);

  SelectObject(mem, old_font);
  DeleteObject(f_title);
  DeleteObject(f_sub);
  DeleteObject(f_stat);

  BitBlt(hdc, 0, 0, rc.right, rc.bottom, mem, 0, 0, SRCCOPY);
  SelectObject(mem, old_bmp);
  DeleteObject(bmp);
  DeleteDC(mem);
  EndPaint(hwnd, &ps);
}

static LRESULT CALLBACK lumi_splash_wndproc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_PAINT:
      lumi_splash_paint(hwnd);
      return 0;
    case WM_ERASEBKGND:
      return 1;
    case LUMI_WM_UPDATE:
      InvalidateRect(hwnd, NULL, FALSE);
      UpdateWindow(hwnd);
      return 0;
    case LUMI_WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcA(hwnd, msg, wp, lp);
  }
}

static DWORD WINAPI lumi_splash_thread_proc(LPVOID param) {
  (void)param;
  HINSTANCE hInst = GetModuleHandleA(NULL);
  const char *cls_name = "AwesomeOsLumiSplashWnd";

  WNDCLASSEXA wc = {0};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = lumi_splash_wndproc;
  wc.hInstance = hInst;
  wc.hCursor = LoadCursorA(NULL, IDC_ARROW);
  wc.hIcon = (HICON)LoadImageA(hInst, MAKEINTRESOURCEA(101), IMAGE_ICON, 32, 32, 0);
  wc.lpszClassName = cls_name;
  RegisterClassExA(&wc);

  int w = 500, h = 212;
  int sw = GetSystemMetrics(SM_CXSCREEN);
  int sh = GetSystemMetrics(SM_CYSCREEN);
  int x = (sw - w) / 2;
  int y = (sh - h) / 2;

  HWND hwnd = CreateWindowExA(
      WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
      cls_name,
      g_lumi_splash.title,
      WS_POPUP | WS_VISIBLE,
      x, y, w, h,
      NULL, NULL, hInst, NULL);

  g_lumi_splash.hwnd = hwnd;
  if (g_lumi_splash.ready_event) {
    SetEvent(g_lumi_splash.ready_event);
  }
  if (!hwnd) return 1;

  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  UpdateWindow(hwnd);

  MSG msg;
  while (GetMessageA(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageA(&msg);
  }
  g_lumi_splash.hwnd = NULL;
  return 0;
}

static void lumi_splash_open(const char *title, const char *subtitle, const char *initial_status) {
  if (!g_lumi_splash.initialized) {
    InitializeCriticalSection(&g_lumi_splash.lock);
    g_lumi_splash.initialized = 1;
  }
  EnterCriticalSection(&g_lumi_splash.lock);
  snprintf(g_lumi_splash.title, sizeof(g_lumi_splash.title), "%s", title ? title : "Awesome-OS");
  snprintf(g_lumi_splash.subtitle, sizeof(g_lumi_splash.subtitle), "%s", subtitle ? subtitle : "b8g-ghost CAS");
  snprintf(g_lumi_splash.status, sizeof(g_lumi_splash.status), "%s", initial_status ? initial_status : "Starting...");
  g_lumi_splash.percent = 5;
  LeaveCriticalSection(&g_lumi_splash.lock);

  g_lumi_splash.ready_event = CreateEventA(NULL, TRUE, FALSE, NULL);
  g_lumi_splash.thread = CreateThread(NULL, 0, lumi_splash_thread_proc, NULL, 0, NULL);
  if (g_lumi_splash.ready_event) {
    WaitForSingleObject(g_lumi_splash.ready_event, 500);
    CloseHandle(g_lumi_splash.ready_event);
    g_lumi_splash.ready_event = NULL;
  }
}

static void lumi_splash_set(int percent, const char *status) {
  if (!g_lumi_splash.initialized) return;
  EnterCriticalSection(&g_lumi_splash.lock);
  g_lumi_splash.percent = percent;
  if (status && status[0] != '\0') {
    snprintf(g_lumi_splash.status, sizeof(g_lumi_splash.status), "%s", status);
  }
  LeaveCriticalSection(&g_lumi_splash.lock);
  if (g_lumi_splash.hwnd) {
    PostMessageA(g_lumi_splash.hwnd, LUMI_WM_UPDATE, 0, 0);
  }
}

static void lumi_splash_close(void) {
  if (g_lumi_splash.hwnd) {
    PostMessageA(g_lumi_splash.hwnd, LUMI_WM_CLOSE, 0, 0);
  }
  if (g_lumi_splash.thread) {
    WaitForSingleObject(g_lumi_splash.thread, 1500);
    CloseHandle(g_lumi_splash.thread);
    g_lumi_splash.thread = NULL;
  }
}

#else
/* POSIX clean terminal progress fallback */
static void lumi_splash_open(const char *title, const char *subtitle, const char *initial_status) {
  fprintf(stderr, "[lumi] %s (%s) — %s\n", title ? title : "Awesome-OS", subtitle ? subtitle : "", initial_status ? initial_status : "");
}
static void lumi_splash_set(int percent, const char *status) {
  fprintf(stderr, "[lumi] [%3d%%] %s\n", percent, status ? status : "");
}
static void lumi_splash_close(void) {}
#endif

#endif /* LUMI_HYDRATION_SPLASH_H */
