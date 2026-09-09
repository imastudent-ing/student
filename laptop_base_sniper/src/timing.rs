//! High-resolution timestamps for latency measurement.
//!
//! Every hot-path event records a monotonic `Instant` (for durations) and a
//! wall-clock nanosecond value (for correlating with on-chain block timestamps
//! and with logs from other machines).

use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Wall-clock time in nanoseconds since the Unix epoch.
#[inline]
pub fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Microseconds elapsed between two instants (saturating, never negative).
#[inline]
pub fn micros_between(from: Instant, to: Instant) -> u128 {
    to.saturating_duration_since(from).as_micros()
}

/// Microseconds elapsed since `from`.
#[inline]
pub fn micros_since(from: Instant) -> u128 {
    micros_between(from, Instant::now())
}
