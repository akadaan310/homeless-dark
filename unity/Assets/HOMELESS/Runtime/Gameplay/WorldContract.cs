using System;
using System.Collections.Generic;

namespace Homeless.Unity.Gameplay
{
    public readonly struct WorldPoint
    {
        public readonly double Latitude, Longitude, Altitude;
        public WorldPoint(double latitude, double longitude, double altitude)
        {
            if (double.IsNaN(latitude) || double.IsNaN(longitude) || double.IsNaN(altitude)
                || double.IsInfinity(latitude) || double.IsInfinity(longitude) || double.IsInfinity(altitude)
                || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || Math.Abs(altitude) > 100000)
                throw new FormatException("World position outside supported domain");
            Latitude = latitude; Longitude = longitude; Altitude = altitude;
        }
        public static WorldPoint Parse(object value)
        {
            var map = WireJson.Object(value);
            return new WorldPoint(WireJson.Number(WireJson.Get(map, "lat")), WireJson.Number(WireJson.Get(map, "lon")),
                                  map.TryGetValue("alt", out var altitude) ? WireJson.Number(altitude) : 0);
        }
    }

    public sealed class WorldEntity
    {
        public string Id, Node, Vehicle, Stance, Mode, Driver;
        public readonly List<string> Passengers = new List<string>();
        public WorldPoint Position;
        public static WorldEntity Parse(object value)
        {
            var map = WireJson.Object(value);
            var entity = new WorldEntity { Id = WireJson.Text(WireJson.Get(map, "id")),
                Node = WireJson.OptionalText(map, "node"), Vehicle = WireJson.OptionalText(map, "vehicle"),
                Stance = WireJson.OptionalText(map, "stance"), Mode = WireJson.OptionalText(map, "mode"),
                Driver = WireJson.OptionalText(map, "driver"),
                Position = WorldPoint.Parse(WireJson.Get(map, "position")) };
            if (map.TryGetValue("passengers", out var riders))
                foreach (var rider in WireJson.Array(riders)) entity.Passengers.Add(WireJson.Text(rider));
            return entity;
        }
    }
    public sealed class WorldSpeech
    {
        public string Id, Speaker, Caption, Act;
        public long Tick;
        public WorldPoint Position;
    }
    public sealed class WorldDestination
    {
        public string Id, Label;
        public bool Ready;
        public WorldPoint Position;
    }
    public sealed class WorldLifeEntity
    {
        public string Id, Kind, Vehicle;
        public WorldPoint Position;
        public Dictionary<string, object> State;
        public readonly List<string> Abilities = new List<string>();
        public void ValidatePresentation()
        {
            if (Abilities.Count > 16) throw new FormatException("Life ability budget exceeded");
            if (Kind == "building")
            {
                Bound(WireJson.Get(State, "light"), 0, 1);
                string door = WireJson.Text(WireJson.Get(State, "door"));
                if (door != "open" && door != "closed") throw new FormatException("Door state refused");
            }
            if (Kind == "tree") Bound(WireJson.Get(State, "glow"), 0, .2);
            if (Kind == "cup")
            {
                var offset = WireJson.Array(WireJson.Get(State, "offset_xz_m"));
                if (offset.Count != 2) throw new FormatException("Cup offset shape refused");
                Bound(offset[0], -1, 1); Bound(offset[1], -1, 1);
            }
            if (Kind == "car")
            {
                string signal = WireJson.Text(WireJson.Get(State, "signal"));
                if (signal != "left" && signal != "right" && signal != "hazard" && signal != "off") throw new FormatException("Vehicle signal refused");
            }
        }
        static void Bound(object value, double minimum, double maximum)
        { double number = WireJson.Number(value); if (number < minimum || number > maximum) throw new FormatException("Life response domain refused"); }
    }
    public sealed class WorldSnapshot
    {
        public long Revision, Tick;
        public string Head;
        public WorldEntity Actor;
        public readonly Dictionary<string, WorldEntity> Nearby = new Dictionary<string, WorldEntity>(StringComparer.Ordinal);
        public readonly Dictionary<string, WorldEntity> Vehicles = new Dictionary<string, WorldEntity>(StringComparer.Ordinal);
        public readonly Dictionary<string, string> Signs = new Dictionary<string, string>(StringComparer.Ordinal);
        public readonly List<WorldSpeech> Speech = new List<WorldSpeech>();
        public readonly List<WorldDestination> Destinations = new List<WorldDestination>();
        public readonly Dictionary<string, WorldLifeEntity> Entities = new Dictionary<string, WorldLifeEntity>(StringComparer.Ordinal);
        public bool HasJourney, JourneyPaused;
        public string LessonId, LessonPrompt;
        public long PlateRevision;
        public readonly List<string> RequiredPlaces = new List<string>();
        public static WorldSnapshot Parse(string json)
        {
            var map = WireJson.Object(WireJson.Parse(json));
            if (WireJson.Text(WireJson.Get(map, "schema")) != "dark.observation/1") throw new FormatException("Observation schema unsupported");
            var snapshot = new WorldSnapshot { Revision = WireJson.Integer(WireJson.Get(map, "revision")),
                Tick = WireJson.Integer(WireJson.Get(map, "tick")), Head = WireJson.Text(WireJson.Get(map, "head")),
                Actor = WorldEntity.Parse(WireJson.Get(map, "actor")) };
            foreach (var name in new[] { "nearby", "vehicles" })
            {
                var entities = WireJson.Object(WireJson.Get(map, name));
                if (entities.Count > 256) throw new FormatException("Active entity budget exceeded");
                foreach (var pair in entities)
                {
                    var entity = WorldEntity.Parse(pair.Value);
                    if (entity.Id != pair.Key) throw new FormatException("Entity identity mismatch");
                    (name == "nearby" ? snapshot.Nearby : snapshot.Vehicles).Add(pair.Key, entity);
                }
            }
            var speech = WireJson.Array(WireJson.Get(map, "speech"));
            if (speech.Count > 128) throw new FormatException("Speech budget exceeded");
            foreach (var entry in speech)
            {
                var item = WireJson.Object(entry);
                snapshot.Speech.Add(new WorldSpeech { Id = WireJson.Text(WireJson.Get(item, "id")),
                    Speaker = WireJson.Text(WireJson.Get(item, "speaker")), Caption = WireJson.Text(WireJson.Get(item, "caption")),
                    Act = WireJson.Text(WireJson.Get(item, "act")), Tick = WireJson.Integer(WireJson.Get(item, "tick")),
                    Position = WorldPoint.Parse(WireJson.Get(item, "position")) });
            }
            if (map.TryGetValue("destinations", out var destinationValue))
            {
                var destinations = WireJson.Array(destinationValue);
                if (destinations.Count > 32) throw new FormatException("Destination budget exceeded");
                foreach (var entry in destinations)
                {
                    var item = WireJson.Object(entry);
                    snapshot.Destinations.Add(new WorldDestination { Id = WireJson.Text(WireJson.Get(item, "id")),
                        Label = WireJson.Text(WireJson.Get(item, "label")), Ready = WireJson.Boolean(WireJson.Get(item, "ready")),
                        Position = WorldPoint.Parse(WireJson.Get(item, "position")) });
                }
            }
            foreach (var pair in WireJson.Object(WireJson.Get(map, "signs")))
                snapshot.Signs.Add(pair.Key, WireJson.Text(WireJson.Get(WireJson.Object(pair.Value), "text")));
            if (map.TryGetValue("journey", out var trip) && trip != null)
            { snapshot.HasJourney = true; snapshot.JourneyPaused = WireJson.Boolean(WireJson.Get(WireJson.Object(trip), "paused")); }
            if (map.TryGetValue("mechanics", out var mechanicsValue) && mechanicsValue != null)
            {
                var mechanics = WireJson.Object(mechanicsValue);
                snapshot.PlateRevision = WireJson.Integer(WireJson.Get(mechanics, "revision"));
                var lesson = WireJson.Object(WireJson.Get(mechanics, "lesson"));
                snapshot.LessonId = WireJson.Text(WireJson.Get(lesson, "id"));
                snapshot.LessonPrompt = WireJson.Text(WireJson.Get(lesson, "prompt"));
                foreach (var place in WireJson.Array(WireJson.Get(lesson, "required_places"))) snapshot.RequiredPlaces.Add(WireJson.Text(place));
            }
            if (map.TryGetValue("entities", out var entityValue))
            {
                var entities = WireJson.Object(entityValue);
                if (entities.Count > 256) throw new FormatException("Visible Life budget exceeded");
                foreach (var pair in entities)
                {
                    var item = WireJson.Object(pair.Value);
                    var entity = new WorldLifeEntity { Id = WireJson.Text(WireJson.Get(item, "id")),
                        Kind = WireJson.Text(WireJson.Get(item, "kind")), Position = WorldPoint.Parse(WireJson.Get(item, "position")),
                        Vehicle = WireJson.OptionalText(item, "vehicle"), State = WireJson.Object(WireJson.Get(item, "state")) };
                    if (entity.Id != pair.Key) throw new FormatException("Life identity mismatch");
                    if (item.TryGetValue("abilities", out var abilities)) foreach (var ability in WireJson.Array(abilities)) entity.Abilities.Add(WireJson.Text(ability));
                    entity.ValidatePresentation();
                    snapshot.Entities.Add(pair.Key, entity);
                }
            }
            return snapshot;
        }
    }

    public sealed class WorldConnection
    {
        public readonly string Origin;
        public readonly string Token;
        WorldConnection(string origin, string token) { Origin = origin; Token = token; }
        public static WorldConnection Parse(string json)
        {
            var map = WireJson.Object(WireJson.Parse(json));
            string origin = WireJson.Text(WireJson.Get(map, "url")), token = WireJson.Text(WireJson.Get(map, "token"));
            if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http")
                || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0 || uri.AbsolutePath != "/"
                || (uri.Scheme == "http" && !uri.IsLoopback)) throw new FormatException("HTTPS origin or explicit loopback origin required");
            if (token.Length < 32 || token.Length > 256) throw new FormatException("Private credential format refused");
            foreach (char c in token)
                if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_'))
                    throw new FormatException("Private credential format refused");
            return new WorldConnection(origin.TrimEnd('/'), token);
        }
    }

    public sealed class WorldProposal
    {
        public readonly string RequestId, Operation, Body;
        public readonly long BaseRevision;
        public WorldProposal(string operation, Dictionary<string, object> input, long revision)
        {
            if (revision < 0 || revision >= 9007199254740991L) throw new ArgumentOutOfRangeException(nameof(revision));
            if (string.IsNullOrEmpty(operation) || operation.Length > 64) throw new ArgumentException("Operation name required");
            foreach (char c in operation) if (!(c >= 'a' && c <= 'z') && c != '_') throw new ArgumentException("Operation name refused");
            RequestId = Guid.NewGuid().ToString("N"); Operation = operation; BaseRevision = revision;
            Body = WireJson.Serialize(WireJson.Map("expected_version", revision + 1, "input", input));
        }
    }
}
