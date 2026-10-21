# Native tools and executable VM checks

This is an implementation/evidence note derived from the constitution, not an alternative specification. Installation was authorized on 21 October 2026. Free tools were installed on this existing VM; no worker, subscription, license purchase, or other chargeable resource was provisioned.

The VM now runs ARM64 OpenJDK 17.0.20.1, adb 1.0.41, QEMU 6.2, Xvfb/Mesa, Blender 3.0.1, eSpeak NG 1.50, CMake 3.22.1, squashfs-tools-ng 1.1.3 and squashfuse 0.1.103. Exact distribution package revisions and command output are in [the readiness report](../evidence/environment/native-install-readiness.json). The package installer is `bash tools/environment/bootstrap_native.sh`.

The locally installed Android diagnostic tools are under `/tmp/homeless-native`: official SDK command-line tools 13.0, selected Android Emulator 37.2.12 binaries/libraries, an isolated x64 Ubuntu library tree, and a previously acquired official API 26 ARM64 default system image (now reclaimed after its bounded probes). This is a **partial diagnostic emulator installation**, not Android Studio or a full Android build toolchain. SDK manager runs on native ARM64 Java. The x64 Android ARM guest engine runs through QEMU user translation. Original downloaded hashes and sparse image allocation are recorded in [Android sources](../evidence/environment/native-install-android-sources.json). These temporary tools are not committed to the game repository or distributed in the APK.

The initial sparse image extraction had 3,381,111,988 logical bytes and used 721,809,408 allocated bytes. After the bounded probes, our temporary image tree was removed to reserve space for the licensed Arabic speech experiment; its final allocation was 727,777,280 bytes. [The reclamation inventory](../evidence/environment/native-install-image-reclamation.json) preserves file sizes, archive URL/hash, and the reason. Probe logs remain. Acquisition was capped at 800 MiB physical image writes and preserved at least 2 GiB free. The verified download archives were removed after extraction to recover our own temporary space. Other users' files were not removed. The remaining reserve is checked before and during boot probes.

## Commands that run now

From the repository root:

```sh
python3 tools/environment/native_readiness.py
python3 tools/environment/vm_check.py
python3 tools/environment/world_wire_check.py
python3 tools/environment/terrain_wire_check.py
python3 tools/environment/unity_api_check.py
```

`native_readiness.py` records tool versions, actual GL context creation, a small original x64 ELF syscall fixture, ARM TCG machine initialization, a KVM attempt, and the translated Android engine/acceleration check. It never reads license or credential contents. Its return does not mean the native game gates passed; inspect the individual results.

`vm_check.py` runs the existing .NET core and mathematical scenarios, a real local sign/NPC persistence fixture, and Unity C# syntax checks. It returns failure if one command fails and stores each log. This is runnable CLI behavior verification. It does not represent a full playable world or replace the separate world-service gameplay scenarios.

The Roslyn tool under `tools/environment/UnitySyntax` uses compiler assemblies from the installed .NET SDK, with no NuGet dependency. It parses the actual Unity C# sources as C# 9 under Android-player and Editor/test symbol profiles. Its negative self-test proves malformed syntax and conditional branches are checked. A deliberately unresolved engine type parses successfully, documenting the limit: **this is syntax checking, not Unity semantic compilation, asset import, physics, rendering, or an APK build**. The existing portable Dark.Core has its own real semantic build/tests.

`python3 tools/environment/android_probe.py --seconds 90` is a bounded attempt against the API 26 image. It now refuses preflight because that temporary image was deliberately reclaimed. Reacquire and verify the exact archive from the source record only after a budget check and a relevant machine/platform configuration fix. It suppresses large process core dumps, preserves a 2 GiB reserve, and records stdout, exit, duration, and adb boot observations. A nonzero result is retained as failure evidence. It is not a background service and does not relaunch blindly. The configured virtual device has ARM64 ABI, one requested core, a 360×640 screen, software graphics, and no audio; the emulator can impose its own RAM minimum, which is visible in its log.

## What was observed

| Route | Actual observation | Next useful change before another attempt |
| --- | --- | --- |
| Native ARM64 tools | Java, adb, QEMU, Blender geometry/FBX, eSpeak, CMake execute | Use them for independent build/content/test work |
| Xvfb/Mesa | GL 4.5 / GLES 3.2 context created, renderer llvmpipe, `Accelerated: no` | An eligible Unity installation is still needed to test Unity rendering |
| QEMU user translation | Original x64 exit fixture returns 42; official Android ARM guest engine `-version` exits 0 | Engine launch requires compatible Android machine configuration and complete dependencies |
| KVM | No `/dev/kvm`; native QEMU KVM attempt fails, official `emulator-check accel` exits 8 | Nested virtualization must actually be exposed by an already available host; installing QEMU did not create this capability |
| Android translated software renderer | After installing the missing x64 X11 dependency and using Xvfb, SwiftShader reports GLES 3.0 | Full Android boot remains separate from GL initialization |
| Android AVD software boot | API26 is recognized, but ranchu machine setup rejects the emulator's `hda` device because no PCI bus is available; disabling AVD audio did not remove that device | Inspect/fix the upstream machine/audio selection or test a compatible pinned native ARM emulator build; do not repeat unchanged arguments |
| Native ARM QEMU kernel | Official kernel and ramdisk execute through Android first-stage init; missing device-tree fstab prevents mounting the system and loading SELinux policy, then it reboots | Supply a correct compatible Android device tree/platform and required devices. This is kernel/init evidence, not successful Android OS boot |
| Waydroid/container candidate | Running kernel configuration enables modular Binder, but the matching Binder module/device is absent | Inspect the matching modules package and Android/Wayland image budget before installation. No container or kernel replacement was performed |
| Full Unity Editor | The full official 4,519,451,520-byte archive was streamed into a 4,340,637,696-byte read-only SquashFS in RAM; upstream MD5 matched, SHA256 recorded. Actual translated `Unity -version` exits 0 and reports 6000.1.0f1 | Legitimate licensing and supported child execution are required before importing the project; Android support/SDK/NDK remain separate |
| Actual Unity/URP references | All 13 runtime and Editor source files compile as C#9/netstandard2.1 against 136 real official engine/Editor/template assemblies, zero warnings/errors; source/reference hashes recorded | Execute actual project import and native scenarios after licensing/runtime prerequisites; semantic compilation is not rendering evidence |
| Actual Editor batch startup | The actual Editor reaches licensing; its x64 licensing child is incorrectly launched by the ARM shell, and the batch exits 199. The unchanged licensing executable itself runs under QEMU and prints version/help | Explicitly translate the legitimate client and preserve its real licensing result; no binary patch or licence bypass |

Actual executable startup/version and managed semantic compilation now have direct evidence. Gameplay import/render/build and physical-device acceptance remain `NOT_RUN`. Emulator tooling and a virtual device cannot measure the Samsung Galaxy A16's 20-minute performance gate or certify cinematic quality. No Android HOMELESS APK was executed in these probes.

Blender's Ubuntu ARM64 package reports `bpy.app.build_options.opencolorio == False`. Its package also omitted color-management assets. The official Blender v3.0.1 color config/LUTs were installed, but that cannot enable a feature compiled out of the executable. Geometry/FBX work remains possible; previews must document their actual color path. [Color source hashes](../evidence/environment/native-install-blender-color.json) preserve this attempted repair.

## Primary source constraints and future checks

Unity documents Linux Editor support for x64 systems and does not certify Editor use through emulation or compatibility layers. This is a support boundary, not proof that every experimental execution route fails. The measured storage/activation conditions are independent. [Unity 6.1 system requirements](https://docs.unity3d.com/6000.1/Documentation/Manual/system-requirements.html), [pinned release](https://unity.com/releases/editor/whats-new/6000.1.0f1), [official component manifest](https://download.unity3d.com/download_unity/9ea152932a88/unity-6000.1.0f1-linux.ini).

The full Editor is mounted read-only at `/tmp/homeless-native/unity-squashfs`; its compressed image lives in `/dev/shm` and will not survive VM restart. `unity_squashfs.py` records and enforces a 5 GiB output cap, 3 GiB memory reserve, one compression worker and 20-minute deadline. The successful stream took 672.755 seconds. See [archive integrity/acquisition](../evidence/environment/native-install-unity-squashfs.json), [actual API compilation](../evidence/environment/native-install-unity-api-compile.json), [translated version](../evidence/environment/native-install-unity-startup-libraries.json) and [bounded batch startup](../evidence/environment/native-install-unity-batch.json). `unity_api_check.py` requires the real mounted references and refuses missing prerequisites. The official archive itself supplies pinned URP 17.1.0 and the template compiled assemblies.

Unity Personal eligibility and activation were not verified; no account or eligibility representation was invented and no activation mechanism was bypassed. Reuse an eligible legitimate installation, then run the project's actual batch import/test/build entry points. [Unity license eligibility](https://unity.com/pages/license-compliance).

Google's standard Linux Studio/Emulator host requirements exclude ARM CPUs; its emulator source nevertheless documents an ARM64 build route with KVM. Software emulation was investigated above rather than inferred impossible. [Android host requirements](https://developer.android.com/studio/install), [emulator ARM64 source route](https://developer.android.com/studio/releases/emulator), [acceleration behavior](https://developer.android.com/studio/run/emulator-acceleration), [QEMU user-mode scope](https://www.qemu.org/docs/master/user/index.html), [Waydroid Binder prerequisites](https://docs.waydro.id/debugging/getting-essential-information).

The managed-cloud environment-status tool was not available in this session, and `/etc/codex/network-policy.json` was absent. Those absences are recorded, not treated as an affirmative policy/credential readiness observation. Existing networking worked for the recorded official package/archive requests; no routes or policy files were changed.

After independent gameplay/content work, rerun readiness and select the next route whose missing prerequisite has actually changed. Preserve the exact logs for each route. Portable work can proceed regardless of these native results; the native gate remains visible until a real build, rendering capture, and physical-device session supply its evidence.

## Authoritative Unity integration entry

The new `Homeless.Editor.GameplaySceneBuilder.PrepareIntegration` method imports the source character FBXs, exact diffuse/normal material bindings, eight original actions, sedan/bus/boat/aircraft models, exact-caption speech WAVs, and café geometry into `Assets/HOMELESS/Scenes/GameplayIntegration.unity`. Its `BuildAndroidIntegration` method builds the ARM64 IL2CPP development APK at `unity/Builds/HOMELESS-Integration.apk` when the pinned licensed Editor and Android support actually exist. The original full-game acceptance gate is not changed by this integration entry. No scene or APK generated by this method is claimed here: the Editor has not executed it.

`WorldClient` reads a private `connection.json` from `Application.persistentDataPath`, or the path in `HOMELESS_CONNECTION_FILE`. Its JSON has `url` and `token` fields; use a currently provisioned member token from `tools/darkctl.py register`, never a source-controlled credential. HTTPS origins are permitted; HTTP is restricted to loopback. Redirects are disabled. Responses are bounded and parsed as strict JSON. Observed revision plus one and a stable idempotency key identify each action; uncertain actions require an explicit retry of the unchanged envelope or an explicit refresh. The client never invents an admitted movement.

A compatible Editor can prepare and build with:

```sh
"$UNITY_EDITOR_PATH" -batchmode -nographics -quit -projectPath unity -executeMethod Homeless.Editor.GameplaySceneBuilder.PrepareIntegration -logFile unity/Logs/gameplay-prepare.log
"$UNITY_EDITOR_PATH" -batchmode -nographics -quit -projectPath unity -executeMethod Homeless.Editor.GameplaySceneBuilder.BuildAndroidIntegration -logFile unity/Logs/gameplay-build.log
adb reverse tcp:8765 tcp:8765
```

Run the real local authority with `python3 tools/darkctl.py serve` after its documented init/register/join commands. A private connection writer is available as `python3 tools/environment/write_connection.py --token-file PRIVATE_TOKEN --output PRIVATE_CONNECTION_JSON`; it does not print the token or overwrite an existing file. On Android, copy that private file to the app's actual persistent-data directory through a developer-authorized device channel. The app's URL is `http://127.0.0.1:8765` with adb reverse. Development-only HTTP is enabled in the integration builder, while the client's origin restriction still applies. [Unity's HTTP setting](https://docs.unity3d.com/6000.1/Documentation/ScriptReference/PlayerSettings-insecureHttpOption.html).

The integration menu sends standing/sitting, conversation, boarding, consented routes, journey pause/resume, place observation, relation, authoring, and the witnessed topology lesson to the authority. Optional public Life observations bind café lighting, palm glow, an authored hollow ceramic cup offset and car signals. Entry/ride decisions create private captions only from verified commit witnesses; causal observations and capability admission stay on the server. Held walking input is at most 5 Hz and expires server-side. Source body movement interpolates admitted samples over the server's current one-second step; camera angles are local. The café has translation (+8,0,+2.5)m from the source ENU chart, leaving the sourced north road clear; its authored apron spawn is provided by the authority. Vehicle seats use the two source upper-leg joint heads as a provisional hip proxy after Animator evaluation; the 0.09m cushion offset is documented in `evidence/content/seated-source.json`, not a native contact measurement. Missing destination scenery is explicitly shown as unavailable. Unmapped vehicle families are not replaced with unrelated models. Source rig, seating fit, hair transparency, imported normal maps, Arabic shaping, shader behavior, terrain fit, collision and device performance all require native inspection.

`FrameTelemetry` writes bounded real-player timing samples and memory/request counters to private `native-frame-measurement.json` every 30 seconds and on pause/quit. It does not collect the connection token or identifier and does not itself certify the prescribed Galaxy A16 session. Current telemetry has not been generated by a native player.

`world_wire_check.py` creates a temporary authoritative world from the real opening content, parses its scoped observation using the actual C# runtime contract, produces an immutable C# proposal, commits the resulting action through Python, and verifies history. [The report](../evidence/environment/native-install-world-wire.json) and [wire-check log](../evidence/environment/native-install-world-wire-tests.log) record this cross-language check. This is semantic execution of the pure wire code; it does not exercise UnityWebRequest, Editor imports or rendering.

## Coarse global landscape adapter

`WorldTerrainView` fetches authenticated `/r/world/terrain` grids through the same private connection, with a 256 KiB response cap, a two-second minimum retry interval and one terrain request at a time. It validates the actual source contract before constructing a 33×33 relief mesh over 10 km. Positions use the double-precision WGS84 frame before conversion to Unity floats; the world origin rebases after 2 km. The opening café/source plate keeps its authored zero-height frame; a conservative 2 km exclusion plus one cell diagonal prevents coarse triangles crossing that area.

GEBCO 6 arcminute data has roughly 11 km latitude spacing and a 32 km Gaussian filter. The 33×33 mesh adds no geographic detail. Its approximate MSL values use the explicitly declared zero-geoid visual approximation also used by the authority, with no surveyed ellipsoid conversion. Ocean water is rendered at zero only when the sample center is classified ocean; its extent is an explicit center-based approximation, not a shoreline mask. No MeshCollider or navigation rights are created. The on-screen notice retains these limits. [Actual source-to-C# checks](../evidence/environment/native-install-terrain-wire.json) cover New York, the dateline and the pole, plus refusal of altered datum, collision claims and malformed grids. Native mesh rendering remains unrun.
