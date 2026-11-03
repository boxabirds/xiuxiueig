//! Zero heap allocation in the render path (owner's rule).
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use jelly_audio::engine::{Engine, OUTPUT_LEN};
use jelly_audio::params::*;

struct Counting;
static ALLOCS: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 { ALLOCS.fetch_add(1, Ordering::SeqCst); System.alloc(l) }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) { System.dealloc(p, l) }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, s: usize) -> *mut u8 { ALLOCS.fetch_add(1, Ordering::SeqCst); System.realloc(p, l, s) }
}
#[global_allocator]
static G: Counting = Counting;

#[test]
fn render_apply_and_plops_never_allocate() {
    let mut e = Box::new(Engine::new(48_000.0));
    let mut out = Box::new([0.0f32; OUTPUT_LEN]);
    let mut p = Box::new([0.0f32; PARAM_COUNT]);
    for v in 0..VOICES { p[v * PER_VOICE + V_FREQ] = 100.0 + v as f32 * 30.0; p[v * PER_VOICE + V_GAIN] = 0.5; }
    p[P_MASTER] = 1.0; p[P_SQUISH] = 0.8; p[P_SQUISH_PITCH] = 600.0; p[P_PLOP_PITCH] = 900.0; p[P_PLOP_GAIN] = 1.0;
    let before = ALLOCS.load(Ordering::SeqCst);
    for b in 0..4000 {
        p[P_PLOP_COUNT] = (b / 50) as f32;
        e.apply_params(&p);
        e.render(&mut out);
    }
    assert_eq!(ALLOCS.load(Ordering::SeqCst) - before, 0);
}
