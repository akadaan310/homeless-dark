using System;
using System.Collections.Generic;

namespace Homeless.Unity.Gameplay
{
    // A coarse source view carries no walking, collision, population or geographic admission rights.
    public sealed class WorldTerrain
    {
        public WorldPoint Center { get; private set; }
        public WorldPoint[] Points { get; private set; }
        public int Width { get; private set; }
        public double Span { get; private set; }
        public bool OceanAtCenter { get; private set; }
        public string Attribution { get; private set; }
        public const string ResolutionNotice = "GEBCO coarse relief · ~11 km source spacing · approximate MSL · no surveyed collision";

        public static WorldTerrain Parse(string json)
        {
            var root = WireJson.Object(WireJson.Parse(json));
            if (WireJson.Text(WireJson.Get(root, "schema")) != "dark.geography-view/1") throw new FormatException("Terrain schema refused");
            foreach (string flag in new[] { "native_collision_ready", "street_precision", "authority_granted", "world_mutation_performed" })
                if (WireJson.Boolean(WireJson.Get(root, flag))) throw new FormatException("Unexpected terrain authority");
            var datum = WireJson.Object(WireJson.Get(root, "rendering_vertical_reference"));
            if (WireJson.Number(WireJson.Get(datum, "assumed_geoid_offset_m")) != 0 || WireJson.Boolean(WireJson.Get(datum, "ellipsoid_conversion_performed")))
                throw new FormatException("Terrain vertical reference changed");
            var resolution = WireJson.Object(WireJson.Get(root, "resolution"));
            if (WireJson.Number(WireJson.Get(resolution, "terrain_spacing_degrees")) != .1
                || WireJson.Boolean(WireJson.Get(resolution, "requested_mesh_spacing_adds_source_detail"))) throw new FormatException("Source resolution changed");
            var center = WireJson.Object(WireJson.Get(root, "center"));
            var grid = WireJson.Object(WireJson.Get(root, "grid"));
            long width = WireJson.Integer(WireJson.Get(grid, "width")), height = WireJson.Integer(WireJson.Get(grid, "height"));
            double span = WireJson.Number(WireJson.Get(grid, "span_m")), step = WireJson.Number(WireJson.Get(grid, "step_m"));
            if (width < 3 || width > 33 || width % 2 != 1 || height != width || span < 1 || span > 10000
                || Math.Abs(step * (width - 1) - span) > .001
                || WireJson.Text(WireJson.Get(grid, "ordering")) != "south-to-north rows; west-to-east columns")
                throw new FormatException("Terrain grid budget or orientation refused");
            var latitudes = WireJson.Array(WireJson.Get(grid, "latitudes"));
            var longitudes = WireJson.Array(WireJson.Get(grid, "longitudes"));
            var heights = WireJson.Array(WireJson.Get(grid, "heights_m_msl"));
            if (latitudes.Count != width * width || longitudes.Count != latitudes.Count || heights.Count != latitudes.Count)
                throw new FormatException("Terrain grid shape refused");
            var terrain = new WorldTerrain { Width = (int)width, Span = span, Points = new WorldPoint[latitudes.Count],
                Center = new WorldPoint(WireJson.Number(WireJson.Get(center, "latitude")), WireJson.Number(WireJson.Get(center, "longitude")),
                    Height(WireJson.Get(center, "terrain_height_m_msl"))) };
            for (int i = 0; i < terrain.Points.Length; i++)
            {
                terrain.Points[i] = new WorldPoint(WireJson.Number(latitudes[i]), WireJson.Number(longitudes[i]), Height(heights[i]));
                if (Distance(terrain.Center, terrain.Points[i]) > span * .72 + 1) throw new FormatException("Terrain vertex outside requested region");
            }
            if (Distance(terrain.Center, terrain.Points[terrain.Points.Length / 2]) > .01)
                throw new FormatException("Terrain center mismatch");
            var water = WireJson.Object(WireJson.Get(root, "water"));
            if (WireJson.Get(water, "grid_water_mask") != null) throw new FormatException("Unrecognized shoreline data");
            terrain.OceanAtCenter = WireJson.Text(WireJson.Get(water, "classification_at_center")) == "ocean";
            var waterHeight = WireJson.Get(water, "surface_height_m_msl");
            if (terrain.OceanAtCenter && (waterHeight == null || WireJson.Number(waterHeight) != 0
                || !WireJson.Boolean(WireJson.Get(water, "surface_is_rendering_assumption")))) throw new FormatException("Water datum changed");
            var sources = WireJson.Object(WireJson.Get(root, "sources"));
            var attribution = new List<string>();
            foreach (var entry in WireJson.Array(WireJson.Get(sources, "attribution"))) attribution.Add(WireJson.Text(entry));
            terrain.Attribution = string.Join("; ", attribution); return terrain;
        }
        static double Height(object value)
        { double height = WireJson.Number(value); if (height < -12000 || height > 12000) throw new FormatException("Terrain height refused"); return height; }
        public static double Distance(WorldPoint a, WorldPoint b)
        {
            double lat1 = a.Latitude * Math.PI / 180, lat2 = b.Latitude * Math.PI / 180;
            double dlat = lat2 - lat1, dlon = (b.Longitude - a.Longitude) * Math.PI / 180;
            double h = Math.Pow(Math.Sin(dlat / 2), 2) + Math.Cos(lat1) * Math.Cos(lat2) * Math.Pow(Math.Sin(dlon / 2), 2);
            return 12742017.6 * Math.Asin(Math.Sqrt(Math.Max(0, Math.Min(1, h))));
        }
    }
}
