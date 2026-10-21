using System.Collections.Generic;
using UnityEngine;

namespace Homeless.Unity.Gameplay
{
    // Rendering only. This deliberately creates no collider from 6 arcminute source relief.
    public sealed class WorldTerrainView : MonoBehaviour
    {
        public WorldClient client;
        public WorldView worldView;
        public Material groundMaterial, waterMaterial;
        WorldTerrain terrain;
        Mesh groundMesh, waterMesh;
        GameObject ground, water;
        Vector3 previousProjection;
        bool dirty, awaiting;
        float nextCheck;
        WorldPoint Opening => new WorldPoint(worldView.anchorLatitude, worldView.anchorLongitude, worldView.anchorAltitude);
        void Awake()
        {
            ground = Surface("Coarse GEBCO relief", groundMaterial, out groundMesh);
            water = Surface("Approximate ocean surface", waterMaterial, out waterMesh);
        }
        GameObject Surface(string name, Material material, out Mesh mesh)
        {
            var surface = new GameObject(name); surface.transform.SetParent(transform, false);
            mesh = new Mesh { name = name }; mesh.MarkDynamic();
            surface.AddComponent<MeshFilter>().sharedMesh = mesh;
            surface.AddComponent<MeshRenderer>().sharedMaterial = material;
            surface.SetActive(false); return surface;
        }
        void LateUpdate()
        {
            var snapshot = client.Snapshot; if (snapshot == null) return;
            var actor = snapshot.Actor.Position;
            bool outsideOpening = WorldTerrain.Distance(actor, Opening) >= 2000;
            if (outsideOpening && !awaiting && Time.realtimeSinceStartup >= nextCheck
                && (terrain == null || WorldTerrain.Distance(actor, terrain.Center) > 1000))
            {
                nextCheck = Time.realtimeSinceStartup + 2;
                awaiting = client.RequestTerrain(actor, result => { awaiting = false; if (result != null) { terrain = result; dirty = true; } });
            }
            bool visible = outsideOpening && terrain != null && WorldTerrain.Distance(actor, terrain.Center) < terrain.Span * .45;
            ground.SetActive(visible); water.SetActive(visible && terrain.OceanAtCenter);
            if (!visible) return;
            Vector3 projected = worldView.Project(terrain.Center);
            if (dirty || (projected - previousProjection).sqrMagnitude > .0001f)
            { Rebuild(); previousProjection = projected; dirty = false; }
        }
        void Rebuild()
        {
            var vertices = new Vector3[terrain.Points.Length]; var waterVertices = new Vector3[vertices.Length];
            var included = new bool[vertices.Length];
            for (int i = 0; i < vertices.Length; i++)
            {
                var point = terrain.Points[i]; vertices[i] = worldView.Project(point);
                waterVertices[i] = worldView.Project(new WorldPoint(point.Latitude, point.Longitude, 0));
                // A diagonal cell margin also excludes triangles whose vertices are outside but edges cross the opening circle.
                included[i] = WorldTerrain.Distance(point, Opening) >= 2000 + 1.415 * terrain.Span / (terrain.Width - 1);
            }
            var triangles = new List<int>((terrain.Width - 1) * (terrain.Width - 1) * 6);
            for (int row = 0; row < terrain.Width - 1; row++)
                for (int column = 0; column < terrain.Width - 1; column++)
                {
                    int a = row * terrain.Width + column, b = a + 1, c = a + terrain.Width, d = c + 1;
                    if (included[a] && included[b] && included[c]) { triangles.Add(a); triangles.Add(c); triangles.Add(b); }
                    if (included[b] && included[c] && included[d]) { triangles.Add(b); triangles.Add(c); triangles.Add(d); }
                }
            groundMesh.Clear(); groundMesh.vertices = vertices; groundMesh.SetTriangles(triangles, 0); groundMesh.RecalculateNormals(); groundMesh.RecalculateBounds();
            waterMesh.Clear();
            if (terrain.OceanAtCenter)
            { waterMesh.vertices = waterVertices; waterMesh.SetTriangles(triangles, 0); waterMesh.RecalculateNormals(); waterMesh.RecalculateBounds(); }
        }
        public string Notice => ground && ground.activeSelf ? WorldTerrain.ResolutionNotice
            + (terrain.OceanAtCenter ? " · ocean extent inferred from center only" : "") : "";
        void OnDestroy()
        {
            if (groundMesh) Destroy(groundMesh); if (waterMesh) Destroy(waterMesh);
            if (ground) Destroy(ground); if (water) Destroy(water);
        }
    }
}
