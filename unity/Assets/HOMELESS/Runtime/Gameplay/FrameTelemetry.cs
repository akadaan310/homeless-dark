using System;
using System.IO;
using UnityEngine;
using UnityEngine.Profiling;

namespace Homeless.Unity.Gameplay
{
    // Bounded measurements from the actual native player. No sample is manufactured by portable checks.
    public sealed class FrameTelemetry : MonoBehaviour
    {
        public WorldClient client;
        readonly float[] frames = new float[18000];
        int next, count;
        long total;
        float previous, nextWrite;
        void Awake() { previous = Time.realtimeSinceStartup; nextWrite = previous + 30; }
        void Update()
        {
            float now = Time.realtimeSinceStartup, elapsed = now - previous; previous = now;
            if (elapsed > 0 && elapsed < 10)
            { frames[next] = elapsed * 1000; next = (next + 1) % frames.Length; count = Math.Min(count + 1, frames.Length); total++; }
            if (now >= nextWrite) { nextWrite = now + 30; Write(); }
        }
        void OnApplicationPause(bool paused) { if (paused) Write(); else previous = Time.realtimeSinceStartup; }
        void OnApplicationQuit() { Write(); }
        void Write()
        {
            if (count == 0) return;
            try
            {
                var sorted = new float[count]; Array.Copy(frames, sorted, count); Array.Sort(sorted);
                double sum = 0; foreach (float sample in sorted) sum += sample;
                var value = WireJson.Map("schema", "dark.native-frame-measurement/1", "utc", DateTime.UtcNow.ToString("O"),
                    "unity", Application.unityVersion, "platform", Application.platform.ToString(),
                    "device_model", SystemInfo.deviceModel, "gpu", SystemInfo.graphicsDeviceName,
                    "graphics_api", SystemInfo.graphicsDeviceType.ToString(), "screen_width", Screen.width, "screen_height", Screen.height,
                    "development_build", Debug.isDebugBuild, "samples", count, "total_samples", total,
                    "mean_frame_ms", sum / count, "p95_frame_ms", sorted[(int)Math.Ceiling(count * .95) - 1],
                    "p99_frame_ms", sorted[(int)Math.Ceiling(count * .99) - 1], "max_frame_ms", sorted[count - 1],
                    "allocated_memory_bytes", Profiler.GetTotalAllocatedMemoryLong(),
                    "reserved_memory_bytes", Profiler.GetTotalReservedMemoryLong(),
                    "requests", client ? client.Requests : 0, "refusals", client ? client.Refusals : 0,
                    "last_request_ms", client ? client.LastRequestMilliseconds : 0,
                    "acceptance", "measurement_only; thermal, battery and prescribed Galaxy A16 scenario require separate evidence");
                string path = Path.Combine(Application.persistentDataPath, "native-frame-measurement.json");
                File.WriteAllText(path + ".tmp", WireJson.Serialize(value));
                if (File.Exists(path)) File.Delete(path);
                File.Move(path + ".tmp", path);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            { /* Storage failure must not interrupt play or disclose private connection configuration. */ }
        }
    }
}
