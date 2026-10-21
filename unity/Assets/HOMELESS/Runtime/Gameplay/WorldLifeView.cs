using System;
using System.Collections.Generic;
using UnityEngine;

namespace Homeless.Unity.Gameplay
{
    // Public admitted Life state has visible effects; no policy or capability is granted here.
    public sealed class WorldLifeView : MonoBehaviour
    {
        public WorldClient client;
        public WorldView worldView;
        public GameObject palmPrefab, cupPrefab;
        readonly Dictionary<string, Appearance> visible = new Dictionary<string, Appearance>(StringComparer.Ordinal);
        WorldSnapshot snapshot;
        int selected;
        bool dirty;
        string lastDecision = "";
        void Awake() { client.Observed += Observe; client.Committed += Committed; }
        void OnDestroy()
        {
            if (client) { client.Observed -= Observe; client.Committed -= Committed; }
            foreach (var appearance in visible.Values) if (appearance.Owned && appearance.Object) Destroy(appearance.Object);
        }
        void Committed(string operation, Dictionary<string, object> data)
        {
            if (operation != "request_entry" && operation != "request_vehicle_ride") return;
            var witness = WireJson.Object(WireJson.Get(data, "witness"));
            var effect = WireJson.Object(WireJson.Get(witness, "effect"));
            string decision = WireJson.Text(WireJson.Get(effect, "decision"));
            lastDecision = operation == "request_entry"
                ? decision == "allow" ? "The café welcomes you in." : "The café cannot welcome you in right now."
                : decision == "offer" ? "The car offers a ride. Choose a seat and agree to the route to travel." : "The car declines the ride.";
            worldView.PresentCaption(lastDecision);
        }
        void Observe(WorldSnapshot value)
        {
            snapshot = value; dirty = true;
        }
        void LateUpdate() { if (dirty) { dirty = false; Refresh(snapshot); } }
        void Refresh(WorldSnapshot value)
        {
            var remove = new List<string>();
            foreach (var pair in visible) if (!value.Entities.ContainsKey(pair.Key)) remove.Add(pair.Key);
            foreach (string key in remove) { if (visible[key].Owned) Destroy(visible[key].Object); visible.Remove(key); }
            foreach (var entity in value.Entities.Values)
            {
                if (visible.TryGetValue(entity.Id, out var prior) && !prior.Object) visible.Remove(entity.Id);
                if (!visible.TryGetValue(entity.Id, out var item))
                {
                    GameObject go = null; bool owned = true;
                    if (entity.Kind == "tree" && palmPrefab) go = Instantiate(palmPrefab);
                    else if (entity.Kind == "cup" && cupPrefab) go = Instantiate(cupPrefab);
                    else if (entity.Kind == "building") go = new GameObject("Cafe interior light");
                    else if (entity.Kind == "car") { go = worldView.VehicleObject(entity.Vehicle); owned = false; }
                    if (!go) continue;
                    item = new Appearance { Object = go, Owned = owned, Renderers = go.GetComponentsInChildren<Renderer>() };
                    if (owned) go.name = entity.Id;
                    if (entity.Kind == "building" || entity.Kind == "tree")
                    {
                        var lamp = new GameObject("Admitted light"); lamp.transform.SetParent(go.transform, false);
                        lamp.transform.localPosition = Vector3.up * (entity.Kind == "building" ? 2.7f : 2.3f);
                        item.Light = lamp.AddComponent<Light>(); item.Light.type = LightType.Point;
                        item.Light.range = entity.Kind == "building" ? 9 : 3;
                        item.Light.color = entity.Kind == "building" ? new Color(1, .86f, .65f) : new Color(.3f, .7f, .25f);
                        item.Light.shadows = LightShadows.None;
                    }
                    visible.Add(entity.Id, item);
                }
                item.Entity = entity;
                if (item.Owned) item.Object.transform.position = worldView.Project(entity.Position);
                if (entity.Kind == "building") item.Light.intensity = (float)WireJson.Number(WireJson.Get(entity.State, "light")) * 3;
                if (entity.Kind == "tree")
                {
                    float glow = (float)WireJson.Number(WireJson.Get(entity.State, "glow"));
                    item.Light.intensity = glow * 2; Emission(item, new Color(.3f, .7f, .25f) * glow);
                }
                if (entity.Kind == "cup")
                {
                    var offset = WireJson.Array(WireJson.Get(entity.State, "offset_xz_m"));
                    if (offset.Count != 2) throw new FormatException("Cup offset shape refused");
                    item.Object.transform.position += new Vector3((float)WireJson.Number(offset[0]), 0, (float)WireJson.Number(offset[1]));
                }
            }
        }
        void Update()
        {
            bool blink = Time.realtimeSinceStartup % 1 < .5f;
            foreach (var item in visible.Values)
            {
                if (item.Entity.Kind != "car" || !item.Object) continue;
                string direction = WireJson.Text(WireJson.Get(item.Entity.State, "signal"));
                foreach (var renderer in item.Renderers)
                {
                    if (!renderer || !(renderer.name.StartsWith("Headlight", StringComparison.Ordinal) || renderer.name.StartsWith("TailLight", StringComparison.Ordinal))) continue;
                    bool left = item.Object.transform.InverseTransformPoint(renderer.bounds.center).x < 0;
                    bool on = blink && (direction == "hazard" || direction == (left ? "left" : "right"));
                    item.Properties.SetColor("_EmissionColor", on ? new Color(2, .6f, .03f) : Color.black);
                    renderer.SetPropertyBlock(item.Properties);
                }
            }
        }
        static void Emission(Appearance item, Color color)
        {
            item.Properties.SetColor("_EmissionColor", color);
            foreach (var renderer in item.Renderers) if (renderer) renderer.SetPropertyBlock(item.Properties);
        }
        void Act(string label, string operation, Dictionary<string, object> input)
        { if (GUILayout.Button(label, GUILayout.MinHeight(38))) client.Propose(operation, input); }
        void Ability(WorldLifeEntity entity, string label, string ability, Dictionary<string, object> input)
        {
            if (entity.Abilities.Contains(ability)) Act(label, "entity_action", WireJson.Map("entity", entity.Id, "ability", ability, "input", input));
        }
        public void DrawActions(string destination)
        {
            if (snapshot == null || snapshot.Entities.Count == 0) return;
            var entities = new List<WorldLifeEntity>(snapshot.Entities.Values); selected = Math.Min(selected, entities.Count - 1);
            var entity = entities[selected];
            if (GUILayout.Button("Around you: " + entity.Id + "  ›", GUILayout.MinHeight(38))) selected = (selected + 1) % entities.Count;
            if (lastDecision.Length > 0) GUILayout.Label(lastDecision);
            if (entity.Kind == "building")
            {
                GUILayout.Label("Entrance: " + WireJson.Text(WireJson.Get(entity.State, "door")));
                Act("Ask to enter", "request_entry", WireJson.Map("entity", entity.Id));
                Ability(entity, "Switch on the lights", "set_light", WireJson.Map("level", 1));
                Ability(entity, "Switch off the lights", "set_light", WireJson.Map("level", 0));
            }
            if (entity.Kind == "tree")
            {
                Ability(entity, "Invite a gentle glow", "glow", WireJson.Map("level", .12));
                Ability(entity, "Let the glow fade", "glow", WireJson.Map("level", 0));
            }
            if (entity.Kind == "cup")
            {
                Ability(entity, "Nudge the cup left", "nudge", WireJson.Map("dx", -.1, "dz", 0));
                Ability(entity, "Nudge the cup right", "nudge", WireJson.Map("dx", .1, "dz", 0));
            }
            if (entity.Kind == "car")
            {
                if (destination != null) Act("Ask this car for a ride", "request_vehicle_ride", WireJson.Map("entity", entity.Id, "destination", destination));
                foreach (string direction in new[] { "left", "right", "hazard", "off" }) Ability(entity, "Signals: " + direction, "signal", WireJson.Map("direction", direction));
            }
        }
        sealed class Appearance
        {
            public GameObject Object;
            public bool Owned;
            public Light Light;
            public WorldLifeEntity Entity;
            public Renderer[] Renderers;
            public readonly MaterialPropertyBlock Properties = new MaterialPropertyBlock();
        }
    }
}
