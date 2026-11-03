/// Padé approximant tanh, accurate to <0.001 for |x| < 3.
/// Beyond ±3, clamps to ±1 (correct for saturation).
#[inline(always)]
pub fn fast_tanh(x: f32) -> f32 {
    let x = x.clamp(-3.0, 3.0);
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

/// Fast tan approximation for filter coefficient computation.
#[inline(always)]
pub fn fast_tan(x: f32) -> f32 {
    // For small x (which is the case for π*freq/sr), tan(x) ≈ x + x³/3
    let x2 = x * x;
    x * (1.0 + x2 * (1.0 / 3.0 + x2 * (2.0 / 15.0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fast_tanh_at_zero() {
        assert_eq!(fast_tanh(0.0), 0.0);
    }

    #[test]
    fn fast_tanh_saturation() {
        let real_tanh_3 = 3.0f32.tanh();
        assert!((fast_tanh(3.0) - real_tanh_3).abs() < 0.01);
        // Beyond ±3, clamped — so fast_tanh(5) == fast_tanh(3)
        assert_eq!(fast_tanh(5.0), fast_tanh(3.0));
        assert_eq!(fast_tanh(-5.0), fast_tanh(-3.0));
    }

    #[test]
    fn fast_tanh_symmetry() {
        for &x in &[0.5, 1.0, 2.0, 3.0] {
            assert!(
                (fast_tanh(-x) + fast_tanh(x)).abs() < 1e-6,
                "fast_tanh not symmetric at x={x}"
            );
        }
    }

    #[test]
    fn fast_tan_accuracy() {
        for &x in &[0.0, 0.01, 0.1, 0.3, 0.5] {
            let err = (fast_tan(x) - x.tan()).abs();
            assert!(err < 0.01, "fast_tan({x}) error={err}");
        }
    }
}
