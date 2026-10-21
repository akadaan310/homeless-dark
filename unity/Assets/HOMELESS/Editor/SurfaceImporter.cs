using System;
using System.IO;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEditor;

namespace Homeless.Editor
{
    public static class SurfaceImporter
    {
        public const string Source = "Assets/HOMELESS/Art/Materials";
        public const string Output = "Assets/HOMELESS/Generated/Materials";
        public static Color32 Pack(byte roughness, byte occlusion) => new Color32(0,occlusion,0,(byte)(255-roughness));
        public static Material Import(string id)
        {
            Directory.CreateDirectory(Output);
            string folder=Source+"/"+id;string prefix=folder+"/"+id+"_2K-JPG_";
            foreach(string file in Directory.GetFiles(folder,"*.jpg"))
            {
                var importer=(TextureImporter)AssetImporter.GetAtPath(file.Replace('\\','/'));
                importer.sRGBTexture=file.EndsWith("_Color.jpg",StringComparison.Ordinal);
                importer.textureType=file.EndsWith("_NormalGL.jpg",StringComparison.Ordinal)?TextureImporterType.NormalMap:TextureImporterType.Default;
                importer.maxTextureSize=1024;importer.mipmapEnabled=true;importer.wrapMode=TextureWrapMode.Repeat;
                importer.filterMode=FilterMode.Trilinear;importer.anisoLevel=4;
                importer.SetPlatformTextureSettings(new TextureImporterPlatformSettings{name="Android",overridden=true,maxTextureSize=1024,format=TextureImporterFormat.ASTC_6x6});
                importer.SaveAndReimport();
            }
            var rough=new Texture2D(2,2,TextureFormat.RGBA32,false,true);
            var ao=new Texture2D(2,2,TextureFormat.RGBA32,false,true);
            Texture2D mask=null;
            try
            {
                if(!ImageConversion.LoadImage(rough,File.ReadAllBytes(prefix+"Roughness.jpg")))throw new IOException("Cannot decode roughness");
                bool hasAo=File.Exists(prefix+"AmbientOcclusion.jpg");
                if(hasAo&&!ImageConversion.LoadImage(ao,File.ReadAllBytes(prefix+"AmbientOcclusion.jpg")))throw new IOException("Cannot decode AO");
                if(hasAo&&(rough.width!=ao.width||rough.height!=ao.height))throw new IOException("Map dimensions differ");
                var r=rough.GetPixels32();var a=hasAo?ao.GetPixels32():null;
                for(int i=0;i<r.Length;i++)r[i]=Pack(r[i].r,hasAo?a[i].r:(byte)255);
                mask=new Texture2D(rough.width,rough.height,TextureFormat.RGBA32,false,true);mask.SetPixels32(r);mask.Apply();
                string maskPath=Output+"/"+id+"_Mask.png";File.WriteAllBytes(maskPath,mask.EncodeToPNG());AssetDatabase.ImportAsset(maskPath);
                var mi=(TextureImporter)AssetImporter.GetAtPath(maskPath);mi.sRGBTexture=false;mi.maxTextureSize=1024;mi.mipmapEnabled=true;
                mi.filterMode=FilterMode.Trilinear;mi.anisoLevel=4;mi.wrapMode=TextureWrapMode.Repeat;
                mi.SetPlatformTextureSettings(new TextureImporterPlatformSettings{name="Android",overridden=true,maxTextureSize=1024,format=TextureImporterFormat.ASTC_6x6});mi.SaveAndReimport();
                string materialPath=Output+"/"+id+".mat";var mat=AssetDatabase.LoadAssetAtPath<Material>(materialPath);
                if(!mat){mat=new Material(RequireShader());AssetDatabase.CreateAsset(mat,materialPath);}
                mat.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(prefix+"Color.jpg"));
                mat.SetTexture("_BumpMap",AssetDatabase.LoadAssetAtPath<Texture2D>(prefix+"NormalGL.jpg"));mat.EnableKeyword("_NORMALMAP");
                mat.SetTexture("_MetallicGlossMap",AssetDatabase.LoadAssetAtPath<Texture2D>(maskPath));mat.EnableKeyword("_METALLICSPECGLOSSMAP");
                mat.SetTexture("_OcclusionMap",AssetDatabase.LoadAssetAtPath<Texture2D>(maskPath));mat.EnableKeyword("_OCCLUSIONMAP");
                mat.SetFloat("_Smoothness",1);mat.SetFloat("_Metallic",0);EditorUtility.SetDirty(mat);return mat;
            }
            finally{UnityEngine.Object.DestroyImmediate(rough);UnityEngine.Object.DestroyImmediate(ao);if(mask)UnityEngine.Object.DestroyImmediate(mask);}
        }
        public static Shader RequireShader()=>Shader.Find("Universal Render Pipeline/Lit")??throw new InvalidOperationException("URP/Lit unavailable; resolve pinned packages first");
        public static Material Solid(string name,Color color,float metallic=0,float smoothness=.3f)
        {
            Directory.CreateDirectory(Output);string path=Output+"/"+name+".mat";var mat=AssetDatabase.LoadAssetAtPath<Material>(path);
            if(!mat){mat=new Material(RequireShader());AssetDatabase.CreateAsset(mat,path);}
            mat.SetColor("_BaseColor",color);mat.SetFloat("_Metallic",metallic);mat.SetFloat("_Smoothness",smoothness);
            if(name=="Glass")
            {
                mat.SetFloat("_Surface",1);mat.SetFloat("_ZWrite",0);mat.SetFloat("_SrcBlend",(float)BlendMode.SrcAlpha);mat.SetFloat("_DstBlend",(float)BlendMode.OneMinusSrcAlpha);
                mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");mat.renderQueue=(int)RenderQueue.Transparent;
            }
            if(name.StartsWith("Awning",StringComparison.Ordinal))mat.SetFloat("_Cull",(float)CullMode.Off);
            EditorUtility.SetDirty(mat);return mat;
        }
    }
}
