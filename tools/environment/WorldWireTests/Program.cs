using System;
using System.Collections.Generic;
using Homeless.Unity.Gameplay;

class Program
{
    static int passed;
    static void Check(bool okay, string name) { if (!okay) throw new Exception(name); passed++; Console.WriteLine("PASS " + name); }
    static void Reject(Action action, string name) { bool rejected = false; try { action(); } catch (FormatException) { rejected = true; } Check(rejected, name); }
    static int Main(string[] args)
    {
        var parsed = WireJson.Object(WireJson.Parse("{\"x\":[1,-2.5e2,true,null,\"مرحبا \\ud83d\\ude42\"]}"));
        Check(WireJson.Array(parsed["x"]).Count == 5, "UTF-8/mixed JSON round trip");
        Check(WireJson.Serialize(WireJson.Parse(WireJson.Serialize(parsed))) == WireJson.Serialize(parsed), "deterministic serialized round trip");
        foreach (string invalid in new[] { "{\"x\":1,\"x\":2}", "{\"x\":NaN}", "01", "1e309", "[1,]", "{\"x\":1,}", "true false", "\"\\ud800\"", "\"\\udc00\"", "\"a\n\"", "1.", "-", "[" })
            Reject(() => WireJson.Parse(invalid), "malformed input refused " + passed);
        Reject(() => WireJson.Parse(new string('[', 26) + "0" + new string(']', 26)), "nesting budget");
        Reject(() => WireJson.Parse("\"" + new string('a', 65537) + "\""), "string budget");
        Reject(() => WireJson.Serialize(double.NaN), "nonfinite output");
        Reject(() => WireJson.Integer(1.5), "fractional revision");
        string credential = new string('x', 43);
        var config = WorldConnection.Parse(WireJson.Serialize(WireJson.Map("url", "http://127.0.0.1:8765", "token", credential)));
        Check(config.Origin == "http://127.0.0.1:8765" && config.Token == credential, "loopback private configuration");
        foreach (string url in new[] { "http://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?token=x", "file:///tmp/world" })
            Reject(() => WorldConnection.Parse(WireJson.Serialize(WireJson.Map("url", url, "token", credential))), "credential origin refused " + passed);
        var input = WireJson.Map("target", "npc:ana", "act", "greeting");
        var proposal = new WorldProposal("talk", input, 7);
        var body = WireJson.Object(WireJson.Parse(proposal.Body));
        Check(WireJson.Integer(body["expected_version"]) == 8 && proposal.RequestId.Length == 32, "server version and stable retry envelope");
        string originalBody = proposal.Body; input["target"] = "npc:changed";
        Check(proposal.Body == originalBody && !proposal.Body.Contains("npc:changed"), "retry cannot pick up subsequently mutated input");
        var point = WireJson.Map("lat", 27.9594638, "lon", -82.5054865, "alt", 0);
        var actor = WireJson.Map("id", "member:one", "node", "cafe", "position", point, "stance", "standing", "vehicle", null);
        var snapshot = WireJson.Map("schema", "dark.observation/1", "revision", 7, "tick", 4, "head", "test-head", "actor", actor,
            "nearby", WireJson.Map(), "vehicles", WireJson.Map(), "speech", new List<object>(), "signs", WireJson.Map(), "journey", null,
            "destinations", new List<object> { WireJson.Map("id", "cafe", "label", "Café", "ready", true, "position", point) });
        var observed = WorldSnapshot.Parse(WireJson.Serialize(snapshot));
        Check(observed.Revision == 7 && observed.Destinations[0].Label == "Café" && observed.Actor.Position.Latitude == 27.9594638, "actual observation contract");
        var cupState = WireJson.Map("offset_xz_m", new List<object> { .05, 0 });
        snapshot["entities"] = WireJson.Map("cup:counter", WireJson.Map("id", "cup:counter", "kind", "cup", "position", point,
            "state", cupState, "abilities", new List<object> { "nudge" }));
        Check(WorldSnapshot.Parse(WireJson.Serialize(snapshot)).Entities["cup:counter"].Abilities[0] == "nudge", "admitted Life presentation contract");
        cupState["offset_xz_m"] = new List<object> { 1.1, 0 };
        Reject(() => WorldSnapshot.Parse(WireJson.Serialize(snapshot)), "out-of-domain Life offset refused before presentation");
        cupState["offset_xz_m"] = new List<object> { 0, 0 };
        snapshot["schema"] = "wrong"; Reject(() => WorldSnapshot.Parse(WireJson.Serialize(snapshot)), "unknown schema");
        Reject(() => new WorldPoint(91, 0, 0), "geographic bounds");
        if (args.Length > 1 && args[0] == "--terrain")
        {
            for (int index = 1; index < args.Length; index++)
            {
                string actualJson = System.IO.File.ReadAllText(args[index]);
                var actualTerrain = WorldTerrain.Parse(actualJson);
                Check(actualTerrain.Points.Length == 1089 && actualTerrain.Width == 33 && actualTerrain.Span == 10000,
                    "actual Python geography source grid accepted " + index);
                Check(actualTerrain.Attribution.Contains("GEBCO") && WorldTerrain.Distance(actualTerrain.Center, actualTerrain.Points[544]) < .01,
                    "terrain source attribution and polar/dateline center " + index);
                var tampered = WireJson.Object(WireJson.Parse(actualJson));
                tampered["native_collision_ready"] = true;
                Reject(() => WorldTerrain.Parse(WireJson.Serialize(tampered)), "coarse terrain cannot claim collision authority " + index);
                tampered["native_collision_ready"] = false;
                var vertical = WireJson.Object(tampered["rendering_vertical_reference"]); vertical["assumed_geoid_offset_m"] = 20;
                Reject(() => WorldTerrain.Parse(WireJson.Serialize(tampered)), "silent datum change refused " + index);
                vertical["assumed_geoid_offset_m"] = 0;
                var grid = WireJson.Object(tampered["grid"]); WireJson.Array(grid["heights_m_msl"]).RemoveAt(0);
                Reject(() => WorldTerrain.Parse(WireJson.Serialize(tampered)), "malformed source mesh refused " + index);
            }
        }
        if (args.Length == 2 && args[0] == "--observe")
        {
            var actual = WorldSnapshot.Parse(System.IO.File.ReadAllText(args[1]));
            Check(actual.Actor.Id == "wire-observer" && actual.Revision >= 2 && actual.Speech.Count > 0 && actual.Destinations.Count > 0,
                "Python authority observation parsed by actual Unity wire contract");
            Check(actual.LessonId == "spruce-quarter-turn" && actual.RequiredPlaces.Count == 3, "Python mechanics observation contract");
            Check(actual.Entities.ContainsKey("building:cafe") && actual.Entities["building:cafe"].Abilities.Contains("set_light"), "Python public Life observation contract");
            System.IO.File.WriteAllText(args[1] + ".proposal", new WorldProposal("sit", WireJson.Map(), actual.Revision).Body);
            System.IO.File.WriteAllText(args[1] + ".life-proposal", new WorldProposal("entity_action",
                WireJson.Map("entity", "building:cafe", "ability", "set_light", "input", WireJson.Map("level", .5)), actual.Revision + 1).Body);
        }
        Console.WriteLine(passed + " portable wire checks passed; Unity native execution NOT_RUN");
        return 0;
    }
}
