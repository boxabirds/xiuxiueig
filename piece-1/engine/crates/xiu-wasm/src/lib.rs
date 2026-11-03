//! Raw `extern "C"` pointer exports for the AudioWorklet: no wasm-bindgen and
//! no copy-back. JS holds `Float32Array` views onto OUTPUT and PARAMS in linear
//! memory, writes params, calls `xiu_render`, and reads the output in place.

use core::ptr::{addr_of, addr_of_mut};

use xiu_dsp::drone::{Engine, OUTPUT_LEN};
use xiu_dsp::params::PARAM_COUNT;

static mut ENGINE: Option<Engine> = None;
static mut OUTPUT: [f32; OUTPUT_LEN] = [0.0; OUTPUT_LEN];
static mut PARAMS: [f32; PARAM_COUNT] = [0.0; PARAM_COUNT];

/// Build the engine. Call once from the worklet constructor (not from process()).
#[no_mangle]
pub extern "C" fn xiu_init(sample_rate: f32) {
    unsafe { *addr_of_mut!(ENGINE) = Some(Engine::new(sample_rate)) };
}

#[no_mangle]
pub extern "C" fn xiu_output_ptr() -> *const f32 {
    addr_of!(OUTPUT) as *const f32
}

#[no_mangle]
pub extern "C" fn xiu_output_len() -> usize {
    OUTPUT_LEN
}

#[no_mangle]
pub extern "C" fn xiu_param_ptr() -> *mut f32 {
    addr_of_mut!(PARAMS) as *mut f32
}

#[no_mangle]
pub extern "C" fn xiu_param_count() -> usize {
    PARAM_COUNT
}

/// Apply PARAMS and render one block into OUTPUT. Allocation-free.
#[no_mangle]
pub extern "C" fn xiu_render() {
    unsafe {
        let engine = &mut *addr_of_mut!(ENGINE);
        if let Some(engine) = engine.as_mut() {
            engine.apply_params(&*addr_of!(PARAMS));
            engine.render(&mut *addr_of_mut!(OUTPUT));
        }
    }
}
