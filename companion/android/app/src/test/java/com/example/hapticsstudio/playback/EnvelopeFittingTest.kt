/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.example.hapticsstudio.playback

import com.example.hapticsstudio.model.AndroidPwle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class EnvelopeFittingTest {

  private val limits = EnvelopeLimits(
      maxSize = 10,
      minPointDurationMs = 10,
      maxPointDurationMs = 100,
      maxDurationMs = 1000,
  )

  private fun pwle(vararg points: Triple<Float, Float, Long>) = AndroidPwle(
      points.map { it.first }.toFloatArray(),
      points.map { it.second }.toFloatArray(),
      points.map { it.third }.toLongArray(),
  )

  private fun FittedEnvelope.durations() = points.map { it.durationMs }

  @Test
  fun emptyEnvelopeIsRejected() {
    assertNull(fitEnvelope(pwle(), limits))
  }

  @Test
  fun silentFirstPointOnlySetsInitialSharpness() {
    val fitted =
        fitEnvelope(pwle(Triple(0f, 0.25f, 0), Triple(1f, 0.5f, 50), Triple(0f, 0.5f, 0)), limits)!!

    assertEquals(0.25f, fitted.initialSharpness, 0f)
    assertEquals(listOf(50L, 10L), fitted.durations())
    assertEquals(listOf(1f, 0f), fitted.points.map { it.amplitude })
  }

  @Test
  fun nonSilentFirstPointRampsUpOverMinDuration() {
    val fitted = fitEnvelope(pwle(Triple(0.5f, 0.5f, 0), Triple(0f, 0.5f, 50)), limits)!!

    assertEquals(listOf(10L, 50L), fitted.durations())
    assertEquals(0.5f, fitted.points[0].amplitude, 0f)
  }

  @Test
  fun silentFirstPointWithLeadInIsKept() {
    val fitted =
        fitEnvelope(
            pwle(Triple(0f, 0.5f, 30), Triple(1f, 0.5f, 50), Triple(0f, 0.5f, 50)),
            limits,
        )!!

    assertEquals(listOf(30L, 50L, 50L), fitted.durations())
  }

  @Test
  fun trailingZeroPointIsStretchedToMinDuration() {
    val fitted =
        fitEnvelope(pwle(Triple(0f, 0f, 0), Triple(1f, 0f, 50), Triple(0f, 0f, 0)), limits)!!

    assertEquals(10L, fitted.points.last().durationMs)
    assertEquals(0f, fitted.points.last().amplitude, 0f)
  }

  @Test
  fun shortPointsAreMergedIntoTheNextOne() {
    val fitted =
        fitEnvelope(
            pwle(
                Triple(0f, 0f, 0),
                Triple(1f, 0f, 50),
                Triple(0.8f, 0f, 4),
                Triple(0.6f, 0f, 4),
                Triple(0.4f, 0f, 20),
                Triple(0f, 0f, 20),
            ),
            limits,
        )!!

    assertEquals(listOf(50L, 28L, 20L), fitted.durations())
    assertEquals(listOf(1f, 0.4f, 0f), fitted.points.map { it.amplitude })
  }

  @Test
  fun longSegmentsAreSplitWithLinearInterpolation() {
    val fitted =
        fitEnvelope(pwle(Triple(0f, 0f, 0), Triple(1f, 1f, 250), Triple(0f, 1f, 50)), limits)!!

    assertEquals(listOf(84L, 83L, 83L, 50L), fitted.durations())
    assertEquals(250L, fitted.durations().take(3).sum())
    assertEquals(1f / 3f, fitted.points[0].amplitude, 1e-6f)
    assertEquals(2f / 3f, fitted.points[1].amplitude, 1e-6f)
    assertEquals(1f, fitted.points[2].amplitude, 1e-6f)
    assertEquals(1f / 3f, fitted.points[0].frequency, 1e-6f)
  }

  @Test
  fun splitPiecesNeverExceedMaxDuration() {
    val fitted =
        fitEnvelope(pwle(Triple(0f, 0f, 0), Triple(1f, 0f, 299), Triple(0f, 0f, 50)), limits)!!

    assertEquals(listOf(100L, 100L, 99L, 50L), fitted.durations())
    assertEquals(299L, fitted.durations().take(3).sum())
  }

  @Test
  fun tooManyPointsAreRejected() {
    val points = (0..11).map { Triple(if (it % 2 == 0) 0f else 1f, 0f, 20L) }.toTypedArray()

    assertNull(fitEnvelope(pwle(*points), limits.copy(maxSize = 5)))
    assertNotNull(fitEnvelope(pwle(*points), limits.copy(maxSize = 12)))
  }

  @Test
  fun tooLongEnvelopeIsRejected() {
    val envelope = pwle(Triple(0f, 0f, 0), Triple(1f, 0f, 60), Triple(0f, 0f, 60))

    assertNull(fitEnvelope(envelope, limits.copy(maxDurationMs = 100)))
    assertNotNull(fitEnvelope(envelope, limits.copy(maxDurationMs = 120)))
  }

  @Test
  fun splitIntoPiecesShorterThanMinIsRejected() {
    val envelope = pwle(Triple(0f, 0f, 0), Triple(1f, 0f, 21), Triple(0f, 0f, 20))
    val tight = EnvelopeLimits(
        maxSize = 10,
        minPointDurationMs = 15,
        maxPointDurationMs = 20,
        maxDurationMs = 1000,
    )

    assertNull(fitEnvelope(envelope, tight))
  }
}
