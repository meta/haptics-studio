/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.example.hapticsstudio.model

import org.json.JSONObject

/** A Haptics Studio desktop instance discovered on the local network. */
data class SocketEndpoint(
    val hostname: String,
    val ip: String,
    val port: Int,
)

/** A single haptic clip belonging to a project. */
data class Clip(
    val clipId: String,
    val name: String,
    val mime: String,
    val lastUpdate: Long,
)

/**
 * A grouping of clips. When [isFolder] is true the group is a named folder containing several
 * clips; otherwise it wraps a single top-level clip.
 */
data class ClipGroup(
    val id: String,
    val name: String?,
    val isFolder: Boolean,
    val clips: List<String>,
)

/** The project currently open in the desktop app. */
data class Project(
    val id: String,
    val name: String,
    val currentClipId: String,
    val clips: List<Clip>,
    val groups: List<ClipGroup>,
    val lastUpdate: Long,
) {
  fun clipById(clipId: String): Clip? = clips.firstOrNull { it.clipId == clipId }

  companion object {
    fun fromJson(json: JSONObject): Project {
      val clips = mutableListOf<Clip>()
      val clipsArray = json.optJSONArray("clips")
      if (clipsArray != null) {
        for (i in 0 until clipsArray.length()) {
          val obj = clipsArray.getJSONObject(i)
          clips.add(
              Clip(
                  clipId = obj.optString("clipId"),
                  name = obj.optString("name"),
                  mime = obj.optString("mime"),
                  lastUpdate = obj.optLong("lastUpdate"),
              ),
          )
        }
      }

      val groups = mutableListOf<ClipGroup>()
      val groupsArray = json.optJSONArray("groups")
      if (groupsArray != null) {
        for (i in 0 until groupsArray.length()) {
          val obj = groupsArray.getJSONObject(i)
          val clipIds = mutableListOf<String>()
          val groupClips = obj.optJSONArray("clips")
          if (groupClips != null) {
            for (j in 0 until groupClips.length()) {
              clipIds.add(groupClips.getString(j))
            }
          }
          groups.add(
              ClipGroup(
                  id = obj.optString("id"),
                  name = if (obj.isNull("name")) null else obj.optString("name"),
                  isFolder = obj.optBoolean("isFolder"),
                  clips = clipIds,
              ),
          )
        }
      }

      return Project(
          id = json.optString("id"),
          name = json.optString("name"),
          currentClipId = json.optString("currentClipId"),
          clips = clips,
          groups = groups,
          lastUpdate = json.optLong("lastUpdate"),
      )
    }
  }
}

/**
 * A pre-rendered Android vibration pattern. [timings] holds the duration in milliseconds of each
 * segment and [amplitudes] the matching amplitude (0-255) for that segment, as expected by
 * [android.os.VibrationEffect.createWaveform].
 */
data class AndroidWaveform(
    val amplitudes: IntArray,
    val timings: LongArray,
) {
  companion object {
    fun fromJson(data: JSONObject): AndroidWaveform {
      val amplitudesArray = data.optJSONArray("amplitudes")
      val timingsArray = data.optJSONArray("timings")
      val count = minOf(amplitudesArray?.length() ?: 0, timingsArray?.length() ?: 0)
      val amplitudes = IntArray(count)
      val timings = LongArray(count)
      for (i in 0 until count) {
        amplitudes[i] = amplitudesArray!!.getInt(i).coerceIn(0, 255)
        timings[i] = timingsArray!!.getLong(i)
      }
      return AndroidWaveform(amplitudes, timings)
    }
  }
}

/**
 * A pre-rendered Android envelope (PWLE) vibration. Each index holds the normalized [amplitudes]
 * and [frequencies] (both 0-1) of a control point, and the [durationsMs] from the previous control
 * point to it. Transient events sent by the desktop are ignored, since Android cannot play an
 * envelope effect and a composition together.
 */
class AndroidPwle(
    val amplitudes: FloatArray,
    val frequencies: FloatArray,
    val durationsMs: LongArray,
) {
  val size: Int
    get() = amplitudes.size

  companion object {
    fun fromJson(data: JSONObject): AndroidPwle {
      val points = data.optJSONArray("control_points")
      val count = points?.length() ?: 0
      val amplitudes = FloatArray(count)
      val frequencies = FloatArray(count)
      val durationsMs = LongArray(count)
      for (i in 0 until count) {
        val point = points!!.getJSONObject(i)
        amplitudes[i] = point.getDouble("amplitude").toFloat().coerceIn(0f, 1f)
        frequencies[i] = point.getDouble("frequency").toFloat().coerceIn(0f, 1f)
        durationsMs[i] = point.getLong("duration_ms").coerceAtLeast(0L)
      }
      return AndroidPwle(amplitudes, frequencies, durationsMs)
    }
  }
}
