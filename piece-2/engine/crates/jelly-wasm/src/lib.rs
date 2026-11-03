//! Raw extern "C" pointer exports for the AudioWorklet (no wasm-bindgen, no copy-back).
use core::ptr::{addr_of, addr_of_mut};
use jelly_audio::engine::{Engine, OUTPUT_LEN};
use jelly_audio::params::PARAM_COUNT;

static mut ENGINE: Option<Engine> = None;
static mut OUTPUT: [f32; OUTPUT_LEN] = [0.0; OUTPUT_LEN];
static mut PARAMS: [f32; PARAM_COUNT] = [0.0; PARAM_COUNT];

#[no_mangle]
pub extern "C" fn jelly_init(sample_rate: f32) {
    unsafe { *addr_of_mut!(ENGINE) = Some(Engine::new(sample_rate)) };
}
#[no_mangle]
pub extern "C" fn jelly_output_ptr() -> *const f32 { addr_of!(OUTPUT) as *const f32 }
#[no_mangle]
pub extern "C" fn jelly_output_len() -> usize { OUTPUT_LEN }
#[no_mangle]
pub extern "C" fn jelly_param_ptr() -> *mut f32 { addr_of_mut!(PARAMS) as *mut f32 }
#[no_mangle]
pub extern "C" fn jelly_param_count() -> usize { PARAM_COUNT }
#[no_mangle]
pub extern "C" fn jelly_render() {
    unsafe {
        if let Some(e) = (*addr_of_mut!(ENGINE)).as_mut() {
            e.apply_params(&*addr_of!(PARAMS));
            e.render(&mut *addr_of_mut!(OUTPUT));
        }
    }
}
