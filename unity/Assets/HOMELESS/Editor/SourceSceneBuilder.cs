using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using Homeless.Unity;

namespace Homeless.Editor
{
    public sealed class BuildPrerequisiteException : Exception { public BuildPrerequisiteException(string message):base(message){} }
    public static class SourceSceneBuilder
    {
        public const string ScenePath="Assets/HOMELESS/Scenes/SourceArtReview.unity";
        const string Generated="Assets/HOMELESS/Generated";
        [MenuItem("HOMELESS/Prepare source art review")]
        public static void PrepareArtReview()
        {
            if(!Application.unityVersion.StartsWith("6000.1.0f1",StringComparison.Ordinal))
                throw new BuildPrerequisiteException("Use pinned Editor 6000.1.0f1; migrations require a reviewed version change");
            Directory.CreateDirectory(Generated);Directory.CreateDirectory("Assets/HOMELESS/Scenes");AssetDatabase.Refresh();
            var renderer=AssetDatabase.LoadAssetAtPath<UniversalRendererData>(Generated+"/MobileRenderer.asset");
            if(!renderer){renderer=ScriptableObject.CreateInstance<UniversalRendererData>();AssetDatabase.CreateAsset(renderer,Generated+"/MobileRenderer.asset");}
            var pipeline=AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(Generated+"/MobileURP.asset");
            if(!pipeline){pipeline=UniversalRenderPipelineAsset.Create(renderer);AssetDatabase.CreateAsset(pipeline,Generated+"/MobileURP.asset");}
            pipeline.renderScale=1;pipeline.msaaSampleCount=2;pipeline.shadowDistance=45;pipeline.supportsHDR=true;
            GraphicsSettings.defaultRenderPipeline=pipeline;QualitySettings.renderPipeline=pipeline;
            PlayerSettings.colorSpace=ColorSpace.Linear;
            var materials=new Dictionary<string,Material>(StringComparer.Ordinal);
            foreach(string id in new[]{"Asphalt024A","Concrete034","Bricks059"})materials.Add(id,SurfaceImporter.Import(id));
            materials.Add("Frame",SurfaceImporter.Solid("Frame",new Color(.12f,.16f,.15f),.65f,.5f));
            materials.Add("Glass",SurfaceImporter.Solid("Glass",new Color(.7f,.86f,.9f,.22f),0,.85f));
            materials.Add("Roof",SurfaceImporter.Solid("Roof",new Color(.18f,.2f,.21f),.1f,.2f));
            materials.Add("Metal",SurfaceImporter.Solid("Metal",new Color(.29f,.31f,.3f),.8f,.4f));
            materials.Add("Wood",SurfaceImporter.Solid("Wood",new Color(.34f,.16f,.07f),0,.35f));
            materials.Add("AwningLight",SurfaceImporter.Solid("AwningLight",new Color(.8f,.74f,.59f),0,.1f));
            materials.Add("AwningDark",SurfaceImporter.Solid("AwningDark",new Color(.1f,.27f,.22f),0,.1f));
            materials.Add("Lamp",SurfaceImporter.Solid("Lamp",new Color(1,.9f,.65f),0,.4f));
            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
            string modelPath="Assets/HOMELESS/Art/Architecture/FictionalCafe/FictionalCafe.obj";
            var importer=AssetImporter.GetAtPath(modelPath) as ModelImporter;
            if(!importer)throw new BuildPrerequisiteException("Acquire original FictionalCafe source before preparing scene");
            importer.globalScale=1;importer.importAnimation=false;importer.isReadable=false;importer.SaveAndReimport();
            var source=AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if(!source)throw new BuildPrerequisiteException("Café OBJ did not import");
            var cafe=(GameObject)PrefabUtility.InstantiatePrefab(source);cafe.name="FictionalCafe";
            foreach(var meshRenderer in cafe.GetComponentsInChildren<MeshRenderer>())
            {
                meshRenderer.sharedMaterials=meshRenderer.sharedMaterials.Select(m=>m&&materials.TryGetValue(m.name,out var chosen)?chosen:throw new BuildPrerequisiteException("Unmapped material on "+meshRenderer.name)).ToArray();
                var filter=meshRenderer.GetComponent<MeshFilter>();
                if(filter&&!meshRenderer.name.StartsWith("awning",StringComparison.Ordinal))
                {var collider=meshRenderer.gameObject.AddComponent<MeshCollider>();collider.sharedMesh=filter.sharedMesh;}
                GameObjectUtility.SetStaticEditorFlags(meshRenderer.gameObject,StaticEditorFlags.BatchingStatic|StaticEditorFlags.ReflectionProbeStatic);
            }
            Ground("Authored street surface",-20,32,-28,-3.1f,-.16f,materials["Asphalt024A"]);
            var paint=SurfaceImporter.Solid("LanePaint",new Color(.85f,.8f,.62f),0,.2f);
            for(int n=-2;n<4;n++)Ground("Lane marking "+n,n*8,n*8+3,-13.05f,-12.9f,-.155f,paint);
            var lightObject=new GameObject("Late afternoon sun");var sun=lightObject.AddComponent<Light>();sun.type=LightType.Directional;sun.intensity=2.4f;sun.color=new Color(1,.92f,.8f);sun.shadows=LightShadows.Soft;
            lightObject.transform.rotation=Quaternion.Euler(32,-32,0);RenderSettings.sun=sun;
            RenderSettings.ambientMode=AmbientMode.Trilight;RenderSettings.ambientSkyColor=new Color(.42f,.54f,.65f);RenderSettings.ambientEquatorColor=new Color(.33f,.35f,.32f);RenderSettings.ambientGroundColor=new Color(.18f,.17f,.15f);
            var skyShader=Shader.Find("Skybox/Procedural");
            if(skyShader)
            {
                string skyPath=Generated+"/ReviewSky.mat";var sky=AssetDatabase.LoadAssetAtPath<Material>(skyPath);
                if(!sky){sky=new Material(skyShader);AssetDatabase.CreateAsset(sky,skyPath);}
                sky.SetFloat("_AtmosphereThickness",.85f);sky.SetFloat("_Exposure",1.1f);RenderSettings.skybox=sky;
            }
            var visitor=new GameObject("Art review visitor");visitor.transform.position=new Vector3(6,.3f,-2.5f);
            var controller=visitor.AddComponent<CharacterController>();controller.height=1.78f;controller.radius=.28f;controller.center=new Vector3(0,.89f,0);controller.stepOffset=.28f;controller.slopeLimit=48;
            var cameraObject=new GameObject("Review camera");cameraObject.tag="MainCamera";cameraObject.transform.SetParent(visitor.transform,false);cameraObject.transform.localPosition=new Vector3(0,1.65f,0);
            var camera=cameraObject.AddComponent<Camera>();camera.nearClipPlane=.08f;camera.farClipPlane=350;camera.fieldOfView=65;
            cameraObject.AddComponent<AudioListener>();visitor.AddComponent<ReviewWalker>().view=camera;
            var sound=visitor.AddComponent<ReviewSoundscape>();
            sound.leftFootstep=Audio("synthetic_footstep_left.wav");sound.rightFootstep=Audio("synthetic_footstep_right.wav");
            sound.outdoorBed=Emitter("Synthetic outdoor bed",new Vector3(6,1,-12),Audio("synthetic_rain_wind_loop.wav"),true,.12f,35);
            sound.arrivalMotif=Emitter("Original arrival motif experiment",new Vector3(6,2,1),Audio("original_arrival_motif.wav"),false,.2f,20);
            camera.GetUniversalAdditionalCameraData().renderPostProcessing=false;
            AssetDatabase.SaveAssets();Physics.SyncTransforms();
            EditorSceneManager.SaveScene(scene,ScenePath);EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene(ScenePath,true)};
            WriteEvidence("source-scene-prepared","Source art review generated in Unity; native visual/device acceptance remains NOT_RUN");
        }
        static AudioClip Audio(string filename)
        {
            var clip=AssetDatabase.LoadAssetAtPath<AudioClip>("Assets/HOMELESS/Audio/"+filename);
            if(!clip)throw new BuildPrerequisiteException("Generate original audio source first: "+filename);
            return clip;
        }
        static AudioSource Emitter(string name,Vector3 position,AudioClip clip,bool loop,float volume,float range)
        {
            var go=new GameObject(name);go.transform.position=position;var audio=go.AddComponent<AudioSource>();
            audio.clip=clip;audio.loop=loop;audio.volume=volume;audio.spatialBlend=1;audio.minDistance=2;audio.maxDistance=range;
            audio.playOnAwake=false;audio.dopplerLevel=0;return audio;
        }
        static void Ground(string name,float x0,float x1,float z0,float z1,float y,Material material)
        {
            var go=new GameObject(name);var mesh=new Mesh{name=name};mesh.vertices=new[]{new Vector3(x0,y,z0),new Vector3(x1,y,z0),new Vector3(x1,y,z1),new Vector3(x0,y,z1)};
            mesh.uv=new[]{new Vector2(x0/3,z0/3),new Vector2(x1/3,z0/3),new Vector2(x1/3,z1/3),new Vector2(x0/3,z1/3)};
            mesh.triangles=new[]{0,2,1,0,3,2};mesh.RecalculateNormals();mesh.RecalculateTangents();
            string path=Generated+"/"+name.Replace(' ','_')+".asset";
            var saved=AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if(saved){EditorUtility.CopySerialized(mesh,saved);UnityEngine.Object.DestroyImmediate(mesh);mesh=saved;}else AssetDatabase.CreateAsset(mesh,path);
            go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;go.AddComponent<MeshCollider>().sharedMesh=mesh;
        }
        public static void ValidateGameplayContent()
        {
            throw new BuildPrerequisiteException("HD-040/085/093: realistic rigged humans, retargeted motion, traffic, spatial audio and native integration have not been verified. Only the explicitly labeled source-art review build is available.");
        }
        // This command fails closed until actual gameplay gates are implemented and evidenced.
        public static void BuildAndroid(){ValidateGameplayContent();}
        [MenuItem("HOMELESS/Build Android source art review (not acceptance)")]
        public static void BuildAndroidArtReview()
        {
            PrepareArtReview();
            if(!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.Android,BuildTarget.Android))throw new BuildPrerequisiteException("Install Android Build Support with SDK, NDK and OpenJDK on the licensed compatible worker");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android,ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures=AndroidArchitecture.ARM64;PlayerSettings.Android.minSdkVersion=AndroidSdkVersions.AndroidApiLevel26;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android,"com.obexden.homeless.artreview");
            EditorUserBuildSettings.buildAppBundle=false;Directory.CreateDirectory("Builds");
            var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{ScenePath},locationPathName="Builds/HOMELESS-ArtReview.apk",target=BuildTarget.Android,options=BuildOptions.Development});
            WriteEvidence("android-art-review-build",report.summary.result+"; duration="+report.summary.totalTime+"; bytes="+report.summary.totalSize);
            if(report.summary.result!=BuildResult.Succeeded)throw new BuildFailedException(report.summary.result.ToString());
        }
        static void WriteEvidence(string name,string result)
        {
            Directory.CreateDirectory("Logs");
            File.WriteAllText("Logs/"+name+".txt","UTC="+DateTime.UtcNow.ToString("O")+"\nEditor="+Application.unityVersion+"\n"+result+"\n");
        }
    }
}
