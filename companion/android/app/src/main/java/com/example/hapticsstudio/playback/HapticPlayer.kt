/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.example.hapticsstudio.playback

import android.content.Context
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.annotation.RequiresApi
import com.example.hapticsstudio.model.AndroidPwle
import com.example.hapticsstudio.model.AndroidWaveform
import java.io.File
import java.io.FileInputStream

private const val TAG = "HapticPlayer"

private const val SILENT_AMPLITUDE = 0.001f

/**
 * Plays a pre-rendered [AndroidWaveform] with [VibrationEffect.createWaveform], or an [AndroidPwle]
 * envelope on devices that support it, synced with the clip's `.wav` audio via [MediaPlayer].
 */
class HapticPlayer(context: Context) {

  private val appContext = context.applicationContext
  private val vibrator: Vibrator =
      (appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager)
          .defaultVibrator
  private val handler = Handler(Looper.getMainLooper())

  private var mediaPlayer: MediaPlayer? = null

  /** Whether the device can play envelope (PWLE) vibration effects. Requires Android 16. */
  val supportsPwle: Boolean =
      Build.VERSION.SDK_INT >= PWLE_MIN_SDK && vibrator.areEnvelopeEffectsSupported()

  /**
   * Plays [waveform] together with [audioFile] when present. [onFinished] is invoked when the audio
   * finishes (or, when there is no audio, after the waveform's total duration elapses).
   */
  fun play(waveform: AndroidWaveform, audioFile: File?, onFinished: () -> Unit) {
    stop()

    if (waveform.timings.isEmpty()) {
      onFinished()
      return
    }

    val effect = VibrationEffect.createWaveform(waveform.timings, waveform.amplitudes, -1)
    start(effect, waveform.timings.sum(), audioFile, onFinished)
  }

  /**
   * Plays [pwle] together with [audioFile] when present. Returns false, without playing anything,
   * when the envelope is empty or cannot be played on this device, so that the caller can fall back
   * to the waveform. [onFinished] is invoked like in the waveform overload.
   */
  fun play(pwle: AndroidPwle, audioFile: File?, onFinished: () -> Unit): Boolean {
    if (!supportsPwle || pwle.size == 0) {
      return false
    }

    stop()

    val envelope =
        try {
          buildEnvelopeEffect(pwle)
        } catch (e: Exception) {
          Log.e(TAG, "Failed to build envelope effect: ${e.message}")
          null
        } ?: return false

    start(envelope.effect, envelope.durationMs, audioFile, onFinished)
    return true
  }

  private fun start(
      effect: VibrationEffect,
      totalDurationMs: Long,
      audioFile: File?,
      onFinished: () -> Unit,
  ) {
    if (audioFile != null && audioFile.exists()) {
      try {
        val player = getMediaPlayer()
        FileInputStream(audioFile).use { stream ->
          player.setDataSource(stream.fd)
        }
        player.setOnCompletionListener { onFinished() }
        player.setOnErrorListener { _, _, _ ->
          onFinished()
          true
        }
        player.prepare()
        player.start()
        handler.postDelayed({ vibrator.vibrate(effect) }, AUDIO_HAPTIC_LATENCY)
        return
      } catch (e: Exception) {
        Log.e(TAG, "Failed to play audio for clip: ${e.message}")
        resetMediaPlayer()
      }
    }

    // No audio (or audio failed): vibrate immediately and clear state after the effect ends.
    vibrator.vibrate(effect)
    handler.postDelayed(onFinished, totalDurationMs)
  }

  @RequiresApi(PWLE_MIN_SDK)
  private fun buildEnvelopeEffect(pwle: AndroidPwle): Envelope? {
    val info = vibrator.envelopeEffectInfo
    val limits = EnvelopeLimits(
        maxSize = info.maxSize.toInt(),
        minPointDurationMs = info.minControlPointDurationMillis.toLong(),
        maxPointDurationMs = info.maxControlPointDurationMillis.toLong(),
        maxDurationMs = info.maxDurationMillis.toLong(),
    )
    val fitted = fitEnvelope(pwle, limits) ?: return null

    val builder = VibrationEffect.BasicEnvelopeBuilder()
    builder.setInitialSharpness(fitted.initialSharpness)
    fitted.points.forEach { builder.addControlPoint(it.amplitude, it.frequency, it.durationMs) }
    return Envelope(builder.build(), fitted.points.sumOf { it.durationMs })
  }

  private class Envelope(val effect: VibrationEffect, val durationMs: Long)

  fun stop() {
    handler.removeCallbacksAndMessages(null)
    vibrator.cancel()
    mediaPlayer?.reset()
  }

  fun release() {
    stop()
    resetMediaPlayer()
  }

  private fun getMediaPlayer(): MediaPlayer {
    val existing = mediaPlayer
    if (existing == null) {
      return MediaPlayer().also { mediaPlayer = it }
    }
    existing.reset()
    return existing
  }

  private fun resetMediaPlayer() {
    mediaPlayer?.release()
    mediaPlayer = null
  }

  companion object {
    // Audio-to-haptic latency offset, in milliseconds.
    const val AUDIO_HAPTIC_LATENCY = 170L

    private const val PWLE_MIN_SDK = 36
  }
}

/** The control point limits reported by the vibrator for envelope effects. */
internal data class EnvelopeLimits(
    val maxSize: Int,
    val minPointDurationMs: Long,
    val maxPointDurationMs: Long,
    val maxDurationMs: Long,
)

/** A control point of an envelope, with the duration from the previous control point. */
internal class ControlPoint(val amplitude: Float, val frequency: Float, val durationMs: Long)

/** An envelope that satisfies the vibrator limits, ready to be passed to the envelope builder. */
internal class FittedEnvelope(val initialSharpness: Float, val points: List<ControlPoint>)

/**
 * Fits [pwle] to the vibrator [limits]. Control points closer than the minimum duration are merged
 * into the next one, and longer ones are split with linear interpolation. The envelope implicitly
 * starts from zero amplitude, so a silent first point without a lead-in only sets the initial
 * frequency. Returns null when the envelope is empty, has too many points, is too long, or cannot
 * be split within the limits.
 */
internal fun fitEnvelope(pwle: AndroidPwle, limits: EnvelopeLimits): FittedEnvelope? {
  if (pwle.size == 0) {
    return null
  }

  val minMs = limits.minPointDurationMs.coerceAtLeast(1L)
  val maxMs = if (limits.maxPointDurationMs > 0) limits.maxPointDurationMs else Long.MAX_VALUE
  val lastIndex = pwle.size - 1

  val merged = ArrayList<ControlPoint>()
  var pendingMs = 0L
  for (i in 0..lastIndex) {
    var durationMs = pwle.durationsMs[i]
    if (i == 0) {
      if (pwle.amplitudes[0] <= SILENT_AMPLITUDE && durationMs < minMs) {
        continue
      }
      durationMs = maxOf(durationMs, minMs)
    }
    pendingMs += durationMs
    if (pendingMs < minMs && i != lastIndex) {
      continue
    }
    merged.add(ControlPoint(pwle.amplitudes[i], pwle.frequencies[i], maxOf(pendingMs, minMs)))
    pendingMs = 0L
  }

  if (merged.isEmpty() || merged.sumOf { it.durationMs } > limits.maxDurationMs) {
    return null
  }

  val initialSharpness = pwle.frequencies[0]
  val points = ArrayList<ControlPoint>()
  var previousAmplitude = 0f
  var previousFrequency = initialSharpness
  for (point in merged) {
    if (point.durationMs > maxMs) {
      val pieces = ((point.durationMs + maxMs - 1) / maxMs).toInt()
      val pieceMs = point.durationMs / pieces
      if (pieceMs < minMs) {
        return null
      }
      val extraMs = (point.durationMs % pieces).toInt()
      for (k in 1..pieces) {
        val durationMs = if (k <= extraMs) pieceMs + 1 else pieceMs
        val t = k.toFloat() / pieces
        points.add(
            ControlPoint(
                previousAmplitude + (point.amplitude - previousAmplitude) * t,
                previousFrequency + (point.frequency - previousFrequency) * t,
                durationMs,
            ),
        )
      }
    } else {
      points.add(point)
    }
    if (points.size > limits.maxSize) {
      return null
    }
    previousAmplitude = point.amplitude
    previousFrequency = point.frequency
  }

  return FittedEnvelope(initialSharpness, points)
}
