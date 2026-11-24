/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.example.hapticsstudio.net

import android.app.Application
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import com.example.hapticsstudio.model.AndroidPwle
import com.example.hapticsstudio.model.AndroidWaveform
import com.example.hapticsstudio.model.Project
import com.example.hapticsstudio.model.SocketEndpoint
import com.example.hapticsstudio.playback.AudioCache
import com.example.hapticsstudio.playback.HapticPlayer
import io.socket.emitter.Emitter
import java.net.URLEncoder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

private const val TAG = "ProjectViewModel"

/**
 * Drives the connection to a single desktop endpoint: Socket.IO handshake, pairing-code auth,
 * project fetch, audio prefetch, and clip playback.
 */
class ProjectViewModel(application: Application) : AndroidViewModel(application) {

  private val socketClient = SocketClient()
  private val audioCache = AudioCache(application)
  private val hapticPlayer = HapticPlayer(application)

  private val _isConnecting = MutableStateFlow(true)
  val isConnecting: StateFlow<Boolean> = _isConnecting.asStateFlow()

  private val _isConnected = MutableStateFlow(false)
  val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

  private val _shouldAuthenticate = MutableStateFlow(false)
  val shouldAuthenticate: StateFlow<Boolean> = _shouldAuthenticate.asStateFlow()

  private val _project = MutableStateFlow<Project?>(null)
  val project: StateFlow<Project?> = _project.asStateFlow()

  private val _currentPlayingClipId = MutableStateFlow<String?>(null)
  val currentPlayingClipId: StateFlow<String?> = _currentPlayingClipId.asStateFlow()

  private var connected = false

  fun connect(endpoint: SocketEndpoint) {
    if (connected) {
      return
    }
    connected = true
    socketClient.connect(endpoint, buildQuery()) { registerHandlers() }
  }

  fun disconnect() {
    socketClient.disconnect()
    hapticPlayer.stop()
    connected = false
  }

  fun sendAuthCode(code: String) {
    socketClient.emit("auth_request", JSONObject().put("authCode", code))
  }

  fun playClip(clipId: String) {
    _currentPlayingClipId.value = clipId
    val event = if (hapticPlayer.supportsPwle) "get_android_pwle" else "get_android"
    socketClient.emit(event, JSONObject().put("clipId", clipId))
  }

  private fun registerHandlers() {
    socketClient.on("auth_required", Emitter.Listener { _shouldAuthenticate.value = true })

    socketClient.on("auth_granted", Emitter.Listener { onAuthenticationGranted() })

    socketClient.on(
        "auth_request",
        Emitter.Listener { args ->
          val message = args.firstOrNull() as? JSONObject
          if (message?.optString("status") == "ok") {
            onAuthenticationGranted()
          }
        },
    )

    socketClient.on(
        "current_project",
        Emitter.Listener { args ->
          val message = args.firstOrNull() as? JSONObject ?: return@Listener
          val project = Project.fromJson(message)
          _project.value = project
          project.clips.forEach { clip ->
            if (!audioCache.exists(clip.clipId)) {
              socketClient.emit(
                  "get_audio",
                  JSONObject().put("clipId", clip.clipId).put("binary", true),
              )
            }
          }
        },
    )

    socketClient.on(
        "get_audio_binary",
        Emitter.Listener { args ->
          val message = args.firstOrNull() as? JSONObject ?: return@Listener
          val clipId = message.optString("clipId")
          val audio = message.opt("audio")
          if (clipId.isNotEmpty() && audio is ByteArray) {
            audioCache.store(clipId, audio)
          }
        },
    )

    socketClient.on(
        "get_android",
        Emitter.Listener { args ->
          val message = args.firstOrNull() as? JSONObject ?: return@Listener
          val clipId = message.optString("clipId")
          val data = message.optJSONObject("data") ?: return@Listener
          val waveform = AndroidWaveform.fromJson(data)
          playWaveform(clipId, waveform)
        },
    )

    socketClient.on(
        "get_android_pwle",
        Emitter.Listener { args ->
          val message = args.firstOrNull() as? JSONObject ?: return@Listener
          val clipId = message.optString("clipId")
          val data = message.optJSONObject("data") ?: return@Listener
          playPwle(clipId, data)
        },
    )
  }

  private fun playPwle(clipId: String, data: JSONObject) {
    val audioFile = if (audioCache.exists(clipId)) audioCache.audioFile(clipId) else null
    val played =
        try {
          hapticPlayer.play(AndroidPwle.fromJson(data), audioFile) { clearPlaying(clipId) }
        } catch (e: Exception) {
          Log.e(TAG, "Failed to play PWLE for clip $clipId: ${e.message}")
          false
        }
    if (!played && _currentPlayingClipId.value == clipId) {
      // The "get_android" reply is played as a waveform and never requests anything else.
      socketClient.emit("get_android", JSONObject().put("clipId", clipId))
    }
  }

  private fun playWaveform(clipId: String, waveform: AndroidWaveform) {
    val audioFile = if (audioCache.exists(clipId)) audioCache.audioFile(clipId) else null
    hapticPlayer.play(waveform, audioFile) { clearPlaying(clipId) }
  }

  private fun clearPlaying(clipId: String) {
    if (_currentPlayingClipId.value == clipId) {
      _currentPlayingClipId.value = null
    }
  }

  private fun onAuthenticationGranted() {
    _shouldAuthenticate.value = false
    _isConnected.value = true
    _isConnecting.value = false
    socketClient.emit("current_project")
  }

  private fun buildQuery(): String {
    val deviceId =
        Settings.Secure.getString(
            getApplication<Application>().contentResolver,
            Settings.Secure.ANDROID_ID,
        ) ?: "unknown"
    val name = "${Build.MANUFACTURER} ${Build.MODEL}"
    val model = Build.MODEL
    return "deviceId=${encode(deviceId)}" +
        "&name=${encode(name)}" +
        "&model=${encode(model)}" +
        "&version=1.0.0"
  }

  private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")

  override fun onCleared() {
    super.onCleared()
    disconnect()
    hapticPlayer.release()
  }
}
