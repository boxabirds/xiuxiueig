//! Proves the CLAUDE.md rule: zero heap allocation in the render path.
mod common;
use common::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use xiu_dsp::drone::{Engine, OUTPUT_LEN};
use xiu_dsp::params::*;

struct CountingAlloc;
static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::SeqCst);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::SeqCst);
        System.realloc(ptr, layout, size)
    }
}

#[global_allocator]
static GLOBAL: CountingAlloc = CountingAlloc;

#[test]
fn render_and_apply_params_never_allocate() {
    const SECONDS: f32 = 30.0; // long enough for every voice to retarget
    let mut engine = Box::new(Engine::new(SAMPLE_RATE));
    let mut out = Box::new([0.0f32; OUTPUT_LEN]);
    let mut params = neutral_params();
    params[P_CONVERGENCE] = 1.0;
    let blocks = blocks_for(SECONDS);

    let before = ALLOCATIONS.load(Ordering::SeqCst);
    for b in 0..blocks {
        params[P_BREATH] = (b % 2) as f32;
        engine.apply_params(&params);
        engine.render(&mut out);
    }
    let after = ALLOCATIONS.load(Ordering::SeqCst);
    assert_eq!(after - before, 0, "render path allocated {} times", after - before);
}
