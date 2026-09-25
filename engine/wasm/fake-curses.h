/*
 * Fake curses for the WebAssembly build.
 *
 * The engine runs exclusively in headless webtiles mode under Emscripten
 * (-headless + the socket bridge in wasm/bridge.h), so the curses code
 * paths in libunix.cc are never executed — but they are still compiled and
 * linked. This header satisfies compilation via the upstream
 * CURSES_INCLUDE_FILE hook (libunix.cc:63) with inline no-ops; there is no
 * terminal to talk to and no ncurses in the Emscripten sysroot.
 *
 * Deliberately NOT defined: NCURSES_VERSION, NCURSES_MOUSE_VERSION,
 * NCURSES_REENTRANT — libunix.cc guards its mouse/ncurses extension code
 * behind these, so leaving them undefined compiles those blocks out.
 * KEY_RESIZE IS defined: its absence would compile IN a
 * signal(SIGWINCH, ...) registration (libunix.cc unixcurses_startup), and
 * there are no terminal resizes in a worker anyway.
 */

#pragma once

#include <cstring>
#include <cwchar>

// ---- basic types -----------------------------------------------------------

typedef struct _fake_window { int _unused; } WINDOW;
typedef int attr_t;
typedef unsigned long chtype;

#define CCHARW_MAX 5
typedef struct
{
    attr_t attr;
    wchar_t chars[CCHARW_MAX];
} cchar_t;

#ifndef ERR
#define ERR (-1)
#endif
#ifndef OK
#define OK (0)
#endif
#ifndef TRUE
#define TRUE 1
#endif
#ifndef FALSE
#define FALSE 0
#endif

// ---- globals ---------------------------------------------------------------

static WINDOW _fake_stdscr;
static WINDOW *stdscr = &_fake_stdscr;
static int LINES = 24;
static int COLS = 80;
static int COLORS = 16;
static int COLOR_PAIRS = 256;
static int ESCDELAY = 20;

// ---- colors / attributes ---------------------------------------------------

#define COLOR_BLACK   0
#define COLOR_RED     1
#define COLOR_GREEN   2
#define COLOR_YELLOW  3
#define COLOR_BLUE    4
#define COLOR_MAGENTA 5
#define COLOR_CYAN    6
#define COLOR_WHITE   7

#define WA_NORMAL     0x0
#define WA_STANDOUT   0x10000
#define WA_UNDERLINE  0x20000
#define WA_REVERSE    0x40000
#define WA_BLINK      0x80000
#define WA_DIM        0x100000
#define WA_BOLD       0x200000

#define A_NORMAL      WA_NORMAL
#define A_CHARTEXT    0xff

#define COLOR_PAIR(n) ((attr_t)(n) << 24)
#define PAIR_NUMBER(a) ((short)(((a) >> 24) & 0xff))

// ---- key codes (values arbitrary but distinct, ncurses-style range) --------

#define KEY_CODE_YES  0400
#define KEY_BREAK     0401
#define KEY_DOWN      0402
#define KEY_UP        0403
#define KEY_LEFT      0404
#define KEY_RIGHT     0405
#define KEY_HOME      0406
#define KEY_BACKSPACE 0407
#define KEY_F0        0410
#define KEY_F(n)      (KEY_F0 + (n))
#define KEY_DC        0512
#define KEY_IC        0513
#define KEY_SF        0520
#define KEY_SR        0521
#define KEY_NPAGE     0522
#define KEY_PPAGE     0523
#define KEY_BTAB      0541
#define KEY_BEG       0542
#define KEY_END       0550
#define KEY_SDC       0577
#define KEY_SEND      0602
#define KEY_SHOME     0607
#define KEY_SLEFT     0611
#define KEY_SNEXT     0612
#define KEY_SPREVIOUS 0614
#define KEY_SRIGHT    0622
#define KEY_MOUSE     0631
#define KEY_RESIZE    0632
#define KEY_A1        0534
#define KEY_A3        0535
#define KEY_B2        0536
#define KEY_C1        0537
#define KEY_C3        0540

// ---- functions (all inert) --------------------------------------------------

static inline WINDOW *initscr(void) { return stdscr; }
static inline int endwin(void) { return OK; }
static inline int isendwin(void) { return TRUE; }
static inline int refresh(void) { return OK; }
static inline int doupdate(void) { return OK; }
static inline int clear(void) { return OK; }
static inline int clrtoeol(void) { return OK; }
static inline int move(int, int) { return OK; }
static inline int raw(void) { return OK; }
static inline int cbreak(void) { return OK; }
static inline int noecho(void) { return OK; }
static inline int nonl(void) { return OK; }
static inline int meta(WINDOW *, bool) { return OK; }
static inline int intrflush(WINDOW *, bool) { return OK; }
static inline int keypad(WINDOW *, bool) { return OK; }
static inline int define_key(const char *, int) { return OK; }
static inline int key_defined(const char *) { return 0; }
static inline int start_color(void) { return OK; }
static inline int use_default_colors(void) { return OK; }
static inline int assume_default_colors(int, int) { return OK; }
static inline int init_pair(short, short, short) { return OK; }
static inline int curs_set(int) { return 1; }
static inline int nodelay(WINDOW *, bool) { return OK; }
static inline void timeout(int) {}
static inline int notimeout(WINDOW *, bool) { return OK; }
static inline int scrollok(WINDOW *, bool) { return OK; }
static inline int napms(int) { return OK; }
static inline int delay_output(int) { return OK; }
static inline int beep(void) { return OK; }
static inline int flash(void) { return OK; }
static inline int attr_set(attr_t, short, void *) { return OK; }
static inline int addnwstr(const wchar_t *, int) { return OK; }
static inline int mvadd_wchnstr(int, int, const cchar_t *, int) { return OK; }
static inline int mvin_wch(int, int, cchar_t *c)
{
    memset(c, 0, sizeof(*c));
    c->chars[0] = L' ';
    return OK;
}
static inline int get_wch(wint_t *) { return ERR; }
static inline char *termname(void) { return (char *)"wasm"; }
static inline int getcurx(WINDOW *) { return 0; }
static inline int getcury(WINDOW *) { return 0; }
static inline int pair_content(short, short *f, short *b)
{
    if (f) *f = COLOR_WHITE;
    if (b) *b = COLOR_BLACK;
    return OK;
}

// cchar_t pack/unpack: pure data ops, so implement them for real — libunix's
// flip_colour/write_char_at round-trip through these.
static inline int setcchar(cchar_t *out, const wchar_t *wch, attr_t attr,
                           short pair, const void *)
{
    memset(out, 0, sizeof(*out));
    int i = 0;
    for (; wch && i < CCHARW_MAX - 1 && wch[i]; ++i)
        out->chars[i] = wch[i];
    out->attr = attr | COLOR_PAIR(pair);
    return OK;
}

static inline int getcchar(const cchar_t *in, wchar_t *wch, attr_t *attr,
                           short *pair, void *)
{
    int len = 0;
    while (len < CCHARW_MAX && in->chars[len])
        ++len;
    if (!wch)
        return len + 1; // ncurses semantics: room needed incl. terminator
    for (int i = 0; i < len; ++i)
        wch[i] = in->chars[i];
    wch[len] = L'\0';
    if (attr)
        *attr = in->attr & ~((attr_t)0xff << 24);
    if (pair)
        *pair = PAIR_NUMBER(in->attr);
    return OK;
}

#define getyx(w, y, x)    ((y) = 0, (x) = 0)
#define getmaxyx(w, y, x) ((y) = LINES, (x) = COLS)
