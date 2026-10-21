using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Homeless.Unity.Gameplay;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace Homeless.Editor
{
    // Produces a runnable integration scene from provenance-bearing sources; acceptance is measured separately.
    public static class GameplaySceneBuilder
    {
        public const string ScenePath = "Assets/HOMELESS/Scenes/GameplayIntegration.unity";
        const string Generated = "Assets/HOMELESS/Generated/Gameplay";
        const string Characters = "Assets/HOMELESS/Content/Characters/";
        const string Families = "Assets/HOMELESS/Content/Families/";

        [MenuItem("HOMELESS/Prepare authoritative world integration")]
        public static void PrepareIntegration()
        {
            SourceSceneBuilder.PrepareArtReview();
            Directory.CreateDirectory(Generated); AssetDatabase.Refresh();
            var materials = CharacterMaterials();
            var citizen = Character("Citizen", materials, false);
            var alternate = Character("CitizenAltSkin", materials, true);
            var sedan = Vehicle("Assets/HOMELESS/Content/Vehicles/CivicSedan.fbx", "CivicSedan");
            var bus = Vehicle(Families + "UrbanBus.fbx", "UrbanBus");
            var boat = Vehicle(Families + "HarborLaunch.fbx", "HarborLaunch");
            var aircraft = Vehicle(Families + "CoastalSixAircraft.fbx", "CoastalSixAircraft");
            var bicycle = Vehicle(Families + "Bicycle.fbx", "Bicycle");
            var helicopter = Vehicle(Families + "RotorShuttle.fbx", "RotorShuttle");
            var palm = Vehicle(Families + "SubtropicalPalm.fbx", "SubtropicalPalm");
            var cup = Vehicle(Families + "CeramicCup.fbx", "CeramicCup");
            var reviewVisitor = GameObject.Find("Art review visitor");
            if (reviewVisitor) UnityEngine.Object.DestroyImmediate(reviewVisitor);
            var geometry = new GameObject("Authored cafe geography");
            foreach (var root in SceneManager.GetActiveScene().GetRootGameObjects())
                if (root != geometry && !root.GetComponent<Light>()) root.transform.SetParent(geometry.transform, true);
            geometry.transform.position = new Vector3(8, 0, 2.5f);

            var clientObject = new GameObject("Authoritative world client");
            var client = clientObject.AddComponent<WorldClient>();
            var presentation = clientObject.AddComponent<WorldView>();
            presentation.client = client; presentation.geographicGeometry = geometry.transform;
            var life = clientObject.AddComponent<WorldLifeView>(); life.client = client; life.worldView = presentation;
            life.palmPrefab = palm; life.cupPrefab = cup; presentation.lifeView = life;
            var landscape = clientObject.AddComponent<WorldTerrainView>(); landscape.client = client; landscape.worldView = presentation;
            landscape.groundMaterial = LandscapeMaterial("CoarseRelief", new Color(.32f, .39f, .24f));
            landscape.waterMaterial = LandscapeMaterial("ApproximateOcean", new Color(.08f, .24f, .36f));
            presentation.terrainView = landscape;
            presentation.citizenPrefab = citizen; presentation.alternateCitizenPrefab = alternate; presentation.sedanPrefab = sedan;
            presentation.vehicleAppearances = new[] {
                new VehicleAppearance { mode = "drive", prefab = sedan }, new VehicleAppearance { mode = "taxi", prefab = sedan },
                new VehicleAppearance { mode = "bus", prefab = bus }, new VehicleAppearance { mode = "boat", prefab = boat },
                new VehicleAppearance { mode = "ferry", prefab = boat }, new VehicleAppearance { mode = "aircraft", prefab = aircraft },
                new VehicleAppearance { mode = "bike", prefab = bicycle }, new VehicleAppearance { mode = "helicopter", prefab = helicopter } };
            presentation.speechClips = Speech();
            presentation.leftFootstep = Required<AudioClip>("Assets/HOMELESS/Audio/synthetic_footstep_left.wav");
            presentation.rightFootstep = Required<AudioClip>("Assets/HOMELESS/Audio/synthetic_footstep_right.wav");
            var bed = GameObject.Find("Synthetic outdoor bed"); presentation.outdoorBed = bed ? bed.GetComponent<AudioSource>() : null;
            var cameraObject = new GameObject("World camera"); cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>(); camera.nearClipPlane = .08f; camera.farClipPlane = 15000; camera.fieldOfView = 65;
            cameraObject.transform.SetPositionAndRotation(new Vector3(0, 1.6f, -3), Quaternion.identity);
            cameraObject.AddComponent<AudioListener>(); camera.GetUniversalAdditionalCameraData().renderPostProcessing = false;
            presentation.view = camera;
            clientObject.AddComponent<FrameTelemetry>().client = client;
            PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
            AssetDatabase.SaveAssets(); Physics.SyncTransforms();
            EditorSceneManager.SaveScene(SceneManager.GetActiveScene(), ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            WriteEvidence("gameplay-integration-prepared", "Source import and scene assembly executed; visual, collision, speech and device acceptance still require native scenarios.");
        }

        static Dictionary<string, Material> CharacterMaterials()
        {
            var manifest = WireJson.Object(WireJson.Parse(File.ReadAllText(Characters + "materials.json")));
            if (WireJson.Text(WireJson.Get(manifest, "schema")) != "dark.character-material-bindings/1")
                throw new BuildPrerequisiteException("Character binding schema changed");
            var result = new Dictionary<string, Material>(StringComparer.Ordinal);
            foreach (var value in WireJson.Array(WireJson.Get(manifest, "bindings")))
            {
                var entry = WireJson.Object(value); string name = WireJson.Text(WireJson.Get(entry, "material"));
                var shader = Shader.Find("Universal Render Pipeline/Lit");
                if (!shader) throw new BuildPrerequisiteException("Pinned URP Lit shader unavailable");
                var material = AssetDatabase.LoadAssetAtPath<Material>(Generated + "/" + name + ".mat");
                if (!material) { material = new Material(shader); AssetDatabase.CreateAsset(material, Generated + "/" + name + ".mat"); }
                material.shader = shader;
                material.SetTexture("_BaseMap", CharacterTexture(WireJson.Object(WireJson.Get(entry, "diffuse")), false));
                material.SetColor("_BaseColor", Color.white); material.SetFloat("_Smoothness", (float)WireJson.Number(WireJson.Get(entry, "smoothness")));
                material.SetFloat("_Metallic", 0); material.SetFloat("_Surface", 0);
                bool clip = WireJson.Boolean(WireJson.Get(entry, "alpha_clip"));
                material.SetFloat("_AlphaClip", clip ? 1 : 0); material.SetFloat("_Cutoff", (float)WireJson.Number(WireJson.Get(entry, "cutoff")));
                if (clip) { material.EnableKeyword("_ALPHATEST_ON"); material.renderQueue = 2450; material.SetOverrideTag("RenderType", "TransparentCutout"); material.SetFloat("_Cull", 0); }
                else { material.DisableKeyword("_ALPHATEST_ON"); material.renderQueue = 2000; material.SetOverrideTag("RenderType", "Opaque"); material.SetFloat("_Cull", 2); }
                if (entry.TryGetValue("normal", out var normal))
                { material.SetTexture("_BumpMap", CharacterTexture(WireJson.Object(normal), true)); material.SetFloat("_BumpScale", 1); material.EnableKeyword("_NORMALMAP"); }
                else { material.SetTexture("_BumpMap", null); material.DisableKeyword("_NORMALMAP"); }
                EditorUtility.SetDirty(material); result.Add(name, material);
            }
            return result;
        }
        static Material LandscapeMaterial(string name, Color color)
        {
            string path = Generated + "/" + name + ".mat";
            var shader = Shader.Find("Universal Render Pipeline/Lit");
            if (!shader) throw new BuildPrerequisiteException("Pinned URP Lit shader unavailable");
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (!material) { material = new Material(shader); AssetDatabase.CreateAsset(material, path); }
            material.shader = shader; material.SetColor("_BaseColor", color); material.SetFloat("_Smoothness", .12f);
            material.SetFloat("_Metallic", 0); EditorUtility.SetDirty(material); return material;
        }
        static Texture2D CharacterTexture(Dictionary<string, object> entry, bool normal)
        {
            string path = WireJson.Text(WireJson.Get(entry, "path"));
            if (!path.StartsWith(Characters + "Textures/", StringComparison.Ordinal) || path.Contains(".."))
                throw new BuildPrerequisiteException("Texture path outside source character package");
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            if (!importer) throw new BuildPrerequisiteException("Source texture did not import: " + path);
            importer.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.sRGBTexture = WireJson.Boolean(WireJson.Get(entry, "srgb")); importer.isReadable = false;
            importer.mipmapEnabled = true; importer.filterMode = FilterMode.Trilinear; importer.anisoLevel = 4; importer.maxTextureSize = 1024;
            var mobile = importer.GetPlatformTextureSettings("Android"); mobile.name = "Android"; mobile.overridden = true;
            mobile.maxTextureSize = 1024; mobile.format = TextureImporterFormat.ASTC_6x6; importer.SetPlatformTextureSettings(mobile);
            importer.SaveAndReimport(); return Required<Texture2D>(path);
        }
        static GameObject Character(string name, Dictionary<string, Material> materials, bool alternate)
        {
            string path = Characters + name + ".fbx";
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (!importer) throw new BuildPrerequisiteException("Source FBX unavailable: " + path);
            importer.globalScale = 1; importer.animationType = ModelImporterAnimationType.Generic; importer.importAnimation = true;
            importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel; importer.isReadable = false;
            importer.SaveAndReimport();
            var definitions = importer.defaultClipAnimations;
            foreach (var clip in definitions) { clip.loopTime = !clip.name.EndsWith("EnterVehicle", StringComparison.Ordinal); clip.lockRootPositionXZ = true; clip.lockRootHeightY = true; clip.lockRootRotation = true; }
            importer.clipAnimations = definitions; importer.SaveAndReimport();
            var source = Required<GameObject>(path);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(source); instance.name = name;
            try
            {
                foreach (var renderer in instance.GetComponentsInChildren<Renderer>())
                    renderer.sharedMaterials = renderer.sharedMaterials.Select(material => {
                        string key = material ? material.name : "";
                        if (alternate && key == "Citizen_Skin") key = "Citizen_Skin_Alternate";
                        if (!materials.TryGetValue(key, out var assigned)) throw new BuildPrerequisiteException("Unknown source character material " + key);
                        return assigned;
                    }).ToArray();
                var animator = instance.GetComponent<Animator>(); if (!animator) animator = instance.AddComponent<Animator>();
                animator.applyRootMotion = false; animator.cullingMode = AnimatorCullingMode.CullUpdateTransforms;
                animator.runtimeAnimatorController = AnimationController(name, path);
                if (!animator.avatar) animator.avatar = AssetDatabase.LoadAllAssetsAtPath(path).OfType<Avatar>().FirstOrDefault();
                return PrefabUtility.SaveAsPrefabAsset(instance, Generated + "/" + name + ".prefab");
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }
        static AnimatorController AnimationController(string name, string source)
        {
            string path = Generated + "/" + name + ".controller";
            var controller = AssetDatabase.LoadAssetAtPath<AnimatorController>(path);
            if (!controller) controller = AnimatorController.CreateAnimatorControllerAtPath(path);
            var machine = controller.layers[0].stateMachine;
            foreach (var state in machine.states) machine.RemoveState(state.state);
            var clips = AssetDatabase.LoadAllAssetsAtPath(source).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview__", StringComparison.Ordinal)).ToArray();
            foreach (string state in new[] { "Idle", "WalkInPlace", "JogInPlace", "Wave", "Talk", "Listen", "Seated", "EnterVehicle" })
            {
                var clip = clips.FirstOrDefault(c => c.name == state || c.name.EndsWith("|" + state, StringComparison.Ordinal));
                if (!clip) throw new BuildPrerequisiteException("Required source action did not import: " + source + " / " + state);
                var added = machine.AddState(state); added.motion = clip;
                if (state == "Idle") machine.defaultState = added;
            }
            EditorUtility.SetDirty(controller); return controller;
        }
        static GameObject Vehicle(string path, string name)
        {
            var importer = AssetImporter.GetAtPath(path) as ModelImporter;
            if (!importer) throw new BuildPrerequisiteException("Source vehicle unavailable: " + path);
            importer.globalScale = 1; importer.importAnimation = false; importer.isReadable = false; importer.SaveAndReimport();
            var source = Required<GameObject>(path); var instance = (GameObject)PrefabUtility.InstantiatePrefab(source); instance.name = name;
            try
            {
                var converted = new Dictionary<Material, Material>();
                foreach (var renderer in instance.GetComponentsInChildren<Renderer>())
                {
                    renderer.sharedMaterials = renderer.sharedMaterials.Select(original => {
                        if (!original) throw new BuildPrerequisiteException("Missing vehicle source material");
                        if (converted.TryGetValue(original, out var found)) return found;
                        if (!original.HasProperty("_BaseColor") && !original.HasProperty("_Color")) throw new BuildPrerequisiteException("Vehicle source color unavailable: " + original.name);
                        Color color = original.HasProperty("_BaseColor") ? original.GetColor("_BaseColor") : original.color;
                        float metallic = original.HasProperty("_Metallic") ? original.GetFloat("_Metallic") : 0;
                        float smoothness = original.HasProperty("_Smoothness") ? original.GetFloat("_Smoothness") : original.HasProperty("_Glossiness") ? original.GetFloat("_Glossiness") : .3f;
                        var chosen = SurfaceImporter.Solid(name + "_" + original.name, color, metallic, smoothness);
                        if (name == "SubtropicalPalm" || original.name == "HeadlampLens" || original.name == "TailLampLens")
                        { chosen.EnableKeyword("_EMISSION"); chosen.SetColor("_EmissionColor", Color.black); }
                        if (color.a < .99f)
                        {
                            chosen.SetFloat("_Surface", 1); chosen.SetFloat("_ZWrite", 0);
                            chosen.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                            chosen.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                            chosen.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); chosen.renderQueue = 3000;
                        }
                        EditorUtility.SetDirty(chosen);
                        converted.Add(original, chosen); return chosen;
                    }).ToArray();
                }
                // Display transforms are driven by observations. Dynamics and colliders require native acceptance.
                return PrefabUtility.SaveAsPrefabAsset(instance, Generated + "/" + name + ".prefab");
            }
            finally { UnityEngine.Object.DestroyImmediate(instance); }
        }
        static SpokenClip[] Speech()
        {
            const string folder = "Assets/HOMELESS/Content/Speech/";
            var manifest = WireJson.Object(WireJson.Parse(File.ReadAllText(folder + "speech.json")));
            if (WireJson.Text(WireJson.Get(manifest, "schema")) != "dark.speech-library/1") throw new BuildPrerequisiteException("Speech schema changed");
            var clips = new List<SpokenClip>(); var captions = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in WireJson.Array(WireJson.Get(manifest, "entries")))
            {
                var entry = WireJson.Object(value); string caption = WireJson.Text(WireJson.Get(entry, "caption"));
                string filename = WireJson.Text(WireJson.Get(entry, "filename"));
                if (Path.GetFileName(filename) != filename || !filename.EndsWith(".wav", StringComparison.Ordinal)) throw new BuildPrerequisiteException("Speech filename refused");
                if (captions.Add(caption)) clips.Add(new SpokenClip { caption = caption, clip = Required<AudioClip>(folder + filename) });
            }
            return clips.ToArray();
        }
        static T Required<T>(string path) where T : UnityEngine.Object
        { var asset = AssetDatabase.LoadAssetAtPath<T>(path); if (!asset) throw new BuildPrerequisiteException("Required source asset did not import: " + path); return asset; }

        [MenuItem("HOMELESS/Build Android authoritative world integration")]
        public static void BuildAndroidIntegration()
        {
            PrepareIntegration();
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android, BuildTarget.Android)) throw new BuildPrerequisiteException("Install licensed compatible Editor Android Build Support and pinned SDK/NDK/JDK");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64; PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel26;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.obexden.homeless.integration");
            EditorUserBuildSettings.buildAppBundle = false; Directory.CreateDirectory("Builds");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = "Builds/HOMELESS-Integration.apk", target = BuildTarget.Android, options = BuildOptions.Development });
            WriteEvidence("android-gameplay-integration-build", report.summary.result + "; duration=" + report.summary.totalTime + "; bytes=" + report.summary.totalSize + "; acceptance scenarios remain separate");
            if (report.summary.result != BuildResult.Succeeded) throw new BuildFailedException(report.summary.result.ToString());
        }
        static void WriteEvidence(string name, string result)
        { Directory.CreateDirectory("Logs"); File.WriteAllText("Logs/" + name + ".txt", "UTC=" + DateTime.UtcNow.ToString("O") + "\nEditor=" + Application.unityVersion + "\n" + result + "\n"); }
    }
}
