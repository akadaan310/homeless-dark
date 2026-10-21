using System;
using System.Collections.Generic;
using Dark.Numerics;
using UnityEngine;

namespace Homeless.Unity.Gameplay
{
    [Serializable] public sealed class SpokenClip { public string caption; public AudioClip clip; }
    [Serializable] public sealed class VehicleAppearance { public string mode; public GameObject prefab; }

    // Presentation of scoped server observations. Camera angles are local; positions come only from admitted samples.
    public sealed class WorldView : MonoBehaviour
    {
        public WorldClient client;
        public Camera view;
        public GameObject citizenPrefab, alternateCitizenPrefab, sedanPrefab;
        public VehicleAppearance[] vehicleAppearances = new VehicleAppearance[0];
        public Transform geographicGeometry;
        public Vector3 geometryOffset = new Vector3(8, 0, 2.5f);
        public double anchorLatitude = 27.9594638, anchorLongitude = -82.5054865, anchorAltitude;
        public SpokenClip[] speechClips = new SpokenClip[0];
        public AudioClip leftFootstep, rightFootstep;
        public AudioSource outdoorBed;
        public WorldLifeView lifeView;
        public WorldTerrainView terrainView;
        public bool thirdPerson = true;
        public float lookSensitivity = .12f;
        public float authoritySampleBlendSeconds = 1;
        readonly Dictionary<string, RenderedEntity> people = new Dictionary<string, RenderedEntity>(StringComparer.Ordinal);
        readonly Dictionary<string, RenderedEntity> cars = new Dictionary<string, RenderedEntity>(StringComparer.Ordinal);
        readonly Dictionary<string, AudioClip> voices = new Dictionary<string, AudioClip>(StringComparer.Ordinal);
        readonly HashSet<string> heard = new HashSet<string>(StringComparer.Ordinal);
        readonly Queue<string> heardOrder = new Queue<string>();
        readonly Queue<WorldSpeech> speechQueue = new Queue<WorldSpeech>();
        readonly Queue<string> captions = new Queue<string>();
        LocalEnuFrame frame;
        WorldPoint origin;
        WorldSnapshot observed;
        RenderedEntity player;
        AudioSource voice, feet;
        float yaw, pitch = 8, nextMove, walked;
        Vector3 previousPlayer;
        Vector2 previousMouse, moveTouch, moveOrigin;
        int moveFinger = -1, lookFinger = -1, destinationIndex, personIndex, vehicleIndex, policyIndex;
        bool menu, muted, paused, first = true, sentMovement, stopRequested, nextLeft = true;
        bool sceneryPresent = true;
        string contribution = "", currentCaption = "";
        float captionUntil;
        Vector2 menuScroll;
        GUIStyle captionStyle;

        void Awake()
        {
            if (!client) client = GetComponent<WorldClient>();
            origin = new WorldPoint(anchorLatitude, anchorLongitude, anchorAltitude); ResetFrame(origin);
            var emitter = new GameObject("Scoped voice emitter"); emitter.transform.SetParent(transform, false);
            voice = emitter.AddComponent<AudioSource>(); voice.playOnAwake = false; voice.spatialBlend = 1;
            voice.minDistance = 2; voice.maxDistance = 25; voice.rolloffMode = AudioRolloffMode.Linear; voice.dopplerLevel = 0;
            feet = gameObject.AddComponent<AudioSource>(); feet.playOnAwake = false; feet.spatialBlend = 0; feet.volume = .25f;
            foreach (var item in speechClips) if (item != null && !string.IsNullOrEmpty(item.caption) && item.clip) voices[item.caption] = item.clip;
            client.Observed += Observe;
            previousMouse = Input.mousePosition; Application.targetFrameRate = 30;
        }
        void Start() { if (outdoorBed) outdoorBed.Play(); }
        void OnDestroy() { if (client) client.Observed -= Observe; }
        void ResetFrame(WorldPoint point)
        {
            origin = point;
            frame = new LocalEnuFrame(new Geodetic(point.Latitude, point.Longitude, point.Altitude), 1000000);
        }
        Vector3 Local(WorldPoint point)
        {
            var v = frame.ToEnu(Geodesy.ToEcef(new Geodetic(point.Latitude, point.Longitude, point.Altitude)));
            return new Vector3((float)v.X, (float)v.Z, (float)v.Y);
        }
        public Vector3 Project(WorldPoint point) => Local(point);
        public GameObject VehicleObject(string id) => id != null && cars.TryGetValue(id, out var car) ? car.Object : null;
        public void PresentCaption(string text)
        {
            currentCaption = text; captionUntil = Time.realtimeSinceStartup + Mathf.Clamp(text.Length / 12f, 3, 10);
            captions.Enqueue(text); while (captions.Count > 6) captions.Dequeue();
        }
        static double GroundDistance(WorldPoint a, WorldPoint b)
        {
            double lat1 = a.Latitude * Math.PI / 180, lat2 = b.Latitude * Math.PI / 180;
            double dlat = lat2 - lat1, dlon = (b.Longitude - a.Longitude) * Math.PI / 180;
            double h = Math.Sin(dlat / 2) * Math.Sin(dlat / 2) + Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(dlon / 2) * Math.Sin(dlon / 2);
            return 12742017.6 * Math.Asin(Math.Sqrt(Math.Min(1, Math.Max(0, h))));
        }
        void Observe(WorldSnapshot snapshot)
        {
            bool shifted = GroundDistance(origin, snapshot.Actor.Position) > 2000;
            if (shifted) { ResetFrame(snapshot.Actor.Position); speechQueue.Clear(); voice.Stop(); }
            observed = snapshot;
            if (geographicGeometry)
            {
                sceneryPresent = GroundDistance(snapshot.Actor.Position, new WorldPoint(anchorLatitude, anchorLongitude, anchorAltitude)) < 250;
                geographicGeometry.gameObject.SetActive(sceneryPresent);
                if (sceneryPresent) geographicGeometry.position = Local(new WorldPoint(anchorLatitude, anchorLongitude, anchorAltitude)) + geometryOffset;
            }
            if (player == null)
            {
                player = Create(snapshot.Actor.Id, citizenPrefab, "Player");
                if (player.Animator) player.Animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            }
            Set(player, snapshot.Actor, shifted || first);
            Sync(snapshot.Nearby, people, false, shifted || first);
            Sync(snapshot.Vehicles, cars, true, shifted || first);
            if (shifted) { previousPlayer = player.Object.transform.position; walked = 0; }
            foreach (var item in snapshot.Speech)
            {
                if (!heard.Add(item.Id)) continue;
                heardOrder.Enqueue(item.Id);
                while (heardOrder.Count > 512) heard.Remove(heardOrder.Dequeue());
                if ((!first || snapshot.Tick - item.Tick <= 4) && speechQueue.Count < 12) speechQueue.Enqueue(item);
            }
            first = false;
        }
        RenderedEntity Create(string id, GameObject prefab, string label)
        {
            var go = prefab ? Instantiate(prefab) : new GameObject(label + " unavailable");
            go.name = label + " " + id;
            var result = new RenderedEntity { Object = go, Animator = go.GetComponentInChildren<Animator>(), Renderers = go.GetComponentsInChildren<Renderer>() };
            if (result.Animator) result.Animator.applyRootMotion = false;
            foreach (var part in go.GetComponentsInChildren<Transform>())
            {
                if (part.name == "upperleg01.L") result.LeftHip = part;
                if (part.name == "upperleg01.R") result.RightHip = part;
                if (part.name == "FrontLeftSeat_OccupantAnchor" || part.name == "DriverOccupant" || part.name == "PilotSeat" || part.name == "HelmSeat" || part.name == "RiderSeat") result.DriverSeat = part;
                if (part.name.Contains("Occupant")) result.Seats.Add(part);
            }
            result.Seats.Sort((a, b) => string.CompareOrdinal(a.name, b.name));
            if (result.DriverSeat) result.Seats.RemoveAll(t => t == result.DriverSeat || (t.position - result.DriverSeat.position).sqrMagnitude < .001f);
            return result;
        }
        void Sync(Dictionary<string, WorldEntity> entities, Dictionary<string, RenderedEntity> rendered, bool vehicles, bool snap)
        {
            var remove = new List<string>();
            foreach (var pair in rendered) if (!entities.ContainsKey(pair.Key)) remove.Add(pair.Key);
            foreach (string key in remove) { Destroy(rendered[key].Object); rendered.Remove(key); }
            foreach (var pair in entities)
            {
                GameObject vehicleModel = null;
                if (vehicles)
                {
                    foreach (var appearance in vehicleAppearances) if (appearance.mode == pair.Value.Mode) { vehicleModel = appearance.prefab; break; }
                    if (!vehicleModel && (pair.Value.Mode == "drive" || pair.Value.Mode == "taxi")) vehicleModel = sedanPrefab;
                    if (!vehicleModel) continue;
                }
                if (!rendered.TryGetValue(pair.Key, out var entity))
                {
                    GameObject model = vehicles ? vehicleModel : (people.Count % 2 == 1 && alternateCitizenPrefab ? alternateCitizenPrefab : citizenPrefab);
                    rendered.Add(pair.Key, entity = Create(pair.Key, model, vehicles ? "Vehicle" : "Inhabitant"));
                    if (vehicles && (pair.Value.Mode == "bike" || pair.Value.Mode == "helicopter"))
                    { entity.Motion = entity.Object.AddComponent<WorldVehicleMotion>(); entity.Motion.Bind(pair.Value.Mode); }
                    Set(entity, pair.Value, true);
                }
                else Set(entity, pair.Value, snap);
            }
        }
        void Set(RenderedEntity rendered, WorldEntity entity, bool snap)
        {
            var target = Local(entity.Position);
            if (snap || !rendered.Initialized) { rendered.Object.transform.position = target; rendered.Start = target; rendered.Target = target; }
            else if ((target - rendered.Target).sqrMagnitude > .0001f)
            {
                rendered.Start = rendered.Object.transform.position; rendered.Target = target; rendered.SampleTime = Time.realtimeSinceStartup;
                Vector3 direction = target - rendered.Start; direction.y = 0;
                if (direction.sqrMagnitude > .01f) rendered.Object.transform.rotation = Quaternion.LookRotation(direction);
            }
            rendered.Initialized = true; rendered.Stance = entity.Stance; rendered.Attached = entity.Vehicle != null;
            rendered.Id = entity.Id; rendered.VehicleId = entity.Vehicle;
        }
        void UpdateEntity(RenderedEntity rendered)
        {
            if (rendered == null) return;
            Vector3 before = rendered.Object.transform.position;
            rendered.Object.transform.position = Vector3.Lerp(rendered.Start, rendered.Target, Mathf.Clamp01((Time.realtimeSinceStartup - rendered.SampleTime) / Mathf.Max(.05f, authoritySampleBlendSeconds)));
            if (rendered.Motion) rendered.Motion.ObserveDisplacement(rendered.Object.transform.position - before);
            bool moving = (rendered.Target - rendered.Object.transform.position).sqrMagnitude > .0004f;
            string state = rendered.Attached || rendered.Stance == "sitting" || rendered.Stance == "seated" ? "Seated" : moving ? "WalkInPlace" : Time.realtimeSinceStartup < rendered.GestureUntil ? rendered.Gesture : "Idle";
            if (rendered.Animator && state != rendered.AnimationState && rendered.Animator.HasState(0, Animator.StringToHash(state)))
            { rendered.Animator.CrossFade(state, .12f); rendered.AnimationState = state; }
        }
        void Update()
        {
            if (Input.GetKeyDown(KeyCode.Escape)) SetPause(!paused);
            if (Input.GetKeyDown(KeyCode.Tab)) { menu = !menu; StopWalking(); }
            if (Input.GetKeyDown(KeyCode.V)) thirdPerson = !thirdPerson;
            foreach (var item in cars.Values) UpdateEntity(item);
            UpdateEntity(player); foreach (var item in people.Values) UpdateEntity(item);
            Vector2 move = Vector2.zero, look = Vector2.zero;
            if (!paused && !menu)
            {
                move = new Vector2((Input.GetKey(KeyCode.D) ? 1 : 0) - (Input.GetKey(KeyCode.A) ? 1 : 0), (Input.GetKey(KeyCode.W) ? 1 : 0) - (Input.GetKey(KeyCode.S) ? 1 : 0));
                if (Input.GetMouseButton(1) && !Input.GetMouseButtonDown(1)) look = (Vector2)Input.mousePosition - previousMouse;
                ReadTouch(ref move, ref look);
                yaw += look.x * lookSensitivity; pitch = Mathf.Clamp(pitch - look.y * lookSensitivity, -65, 65);
            }
            previousMouse = Input.mousePosition;
            if (observed != null && player != null)
            {
                bool canWalk = observed.Actor.Vehicle == null && (observed.Actor.Stance == "standing" || observed.Actor.Stance == "walking") && !observed.HasJourney;
                if (!canWalk) move = Vector2.zero;
                move = Vector2.ClampMagnitude(move, 1);
                bool active = move.sqrMagnitude > .01f && !paused && !menu;
                if (Time.realtimeSinceStartup >= nextMove && !client.Busy && client.Fresh && !client.HasUncertainRequest)
                {
                    if (active)
                    {
                        var direction = Quaternion.Euler(0, yaw, 0) * new Vector3(move.x, 0, move.y);
                        if (client.Propose("manual_move", WireJson.Map("east", (double)Mathf.Clamp(direction.x, -1, 1), "north", (double)Mathf.Clamp(direction.z, -1, 1)))) { sentMovement = true; nextMove = Time.realtimeSinceStartup + .2f; }
                    }
                    else if (sentMovement || stopRequested)
                    {
                        if (client.Propose("manual_move", WireJson.Map("east", 0, "north", 0))) { sentMovement = stopRequested = false; nextMove = Time.realtimeSinceStartup + .2f; }
                    }
                }
                Vector3 location = player.Object.transform.position;
                player.Object.transform.rotation = Quaternion.Euler(0, yaw, 0);
                foreach (var renderer in player.Renderers) renderer.enabled = thirdPerson;
                float height = observed.Actor.Vehicle != null || observed.Actor.Stance == "sitting" ? 1.05f : 1.6f;
                Vector3 eye = location + Vector3.up * height;
                var rotation = Quaternion.Euler(pitch, yaw, 0);
                var cameraPosition = eye;
                if (thirdPerson)
                {
                    Vector3 offset = rotation * new Vector3(.35f, .25f, -3.2f);
                    if (Physics.SphereCast(eye, .18f, offset.normalized, out RaycastHit hit, offset.magnitude, ~0, QueryTriggerInteraction.Ignore))
                        cameraPosition = eye + offset.normalized * Mathf.Max(.1f, hit.distance - .08f);
                    else cameraPosition = eye + offset;
                }
                view.transform.SetPositionAndRotation(cameraPosition, rotation);
                var displacement = location - previousPlayer; previousPlayer = location; displacement.y = 0;
                if (displacement.magnitude > 2 || !canWalk) walked = 0;
                else walked += displacement.magnitude;
                if (walked >= .7f)
                {
                    walked %= .7f; AudioClip clip = nextLeft ? leftFootstep : rightFootstep; nextLeft = !nextLeft;
                    if (clip && !muted && !paused) feet.PlayOneShot(clip);
                }
            }
            if (!paused && !voice.isPlaying && speechQueue.Count > 0)
            {
                var utterance = speechQueue.Dequeue(); currentCaption = Display(utterance.Speaker) + ": " + utterance.Caption;
                captionUntil = Time.realtimeSinceStartup + Mathf.Clamp(utterance.Caption.Length / 12f, 3, 10);
                captions.Enqueue(currentCaption); while (captions.Count > 6) captions.Dequeue();
                var speaker = observed != null && utterance.Speaker == observed.Actor.Id ? player : people.TryGetValue(utterance.Speaker, out var person) ? person : null;
                if (speaker != null) { speaker.Gesture = utterance.Act == "greeting" ? "Wave" : "Talk"; speaker.GestureUntil = captionUntil; }
                if (!muted && voices.TryGetValue(utterance.Caption, out var clip))
                { voice.transform.position = Local(utterance.Position) + Vector3.up * 1.5f; voice.clip = clip; voice.Play(); captionUntil = Time.realtimeSinceStartup + clip.length + .5f; }
            }
        }
        void LateUpdate()
        {
            if (player == null) return;
            Vector3 before = player.Object.transform.position;
            AlignSeat(player); foreach (var person in people.Values) AlignSeat(person);
            if (view) view.transform.position += player.Object.transform.position - before;
        }
        void AlignSeat(RenderedEntity person)
        {
            if (!person.Attached || !person.LeftHip || !person.RightHip || observed == null
                || !observed.Vehicles.TryGetValue(person.VehicleId, out var vehicle) || !cars.TryGetValue(person.VehicleId, out var rendered)) return;
            Transform seat = null;
            if (vehicle.Driver == person.Id) seat = rendered.DriverSeat;
            else
            {
                int index = vehicle.Passengers.IndexOf(person.Id);
                if (index >= 0 && index < rendered.Seats.Count) seat = rendered.Seats[index];
            }
            if (!seat) return;
            person.Object.transform.rotation = rendered.Object.transform.rotation;
            // Source proxy from seated-source.json. Native cushion/thigh/foot contact remains an acceptance check.
            Vector3 hips = (person.LeftHip.position + person.RightHip.position) * .5f;
            person.Object.transform.position += seat.position + Vector3.up * .09f - hips;
        }
        void ReadTouch(ref Vector2 move, ref Vector2 look)
        {
            for (int i = 0; i < Input.touchCount; i++)
            {
                Touch touch = Input.GetTouch(i);
                if (touch.phase == TouchPhase.Began && touch.position.y < Screen.height - 110 && touch.position.y > 90)
                {
                    if (touch.position.x < Screen.width * .5f && moveFinger < 0) { moveFinger = touch.fingerId; moveOrigin = touch.position; }
                    else if (lookFinger < 0) lookFinger = touch.fingerId;
                }
                bool ended = touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled;
                if (touch.fingerId == moveFinger) { moveTouch = ended ? Vector2.zero : Vector2.ClampMagnitude((touch.position - moveOrigin) / Mathf.Max(80, Screen.height * .12f), 1); if (ended) moveFinger = -1; }
                if (touch.fingerId == lookFinger) { if (!ended) look += touch.deltaPosition; if (ended) lookFinger = -1; }
            }
            move += moveTouch;
        }
        void StopWalking() { moveFinger = lookFinger = -1; moveTouch = Vector2.zero; stopRequested = sentMovement; }
        void SetPause(bool value) { paused = value; StopWalking(); if (voice) { if (paused) voice.Pause(); else voice.UnPause(); } if (outdoorBed) { if (paused) outdoorBed.Pause(); else outdoorBed.UnPause(); } }
        void OnApplicationPause(bool value) { if (value) SetPause(true); }
        void OnApplicationFocus(bool focused) { if (!focused) SetPause(true); }
        string PlaceLabel(string id)
        {
            if (observed != null) foreach (var place in observed.Destinations) if (place.Id == id) return place.Label;
            return Display(id);
        }
        static string Display(string id) { if (string.IsNullOrEmpty(id)) return "Traveller"; int index = id.LastIndexOf(':'); return index < 0 ? id : id.Substring(index + 1); }
        void Action(string label, string operation, Dictionary<string, object> input)
        { if (GUILayout.Button(label, GUILayout.MinHeight(38))) { StopWalking(); client.Propose(operation, input); } }
        void OnGUI()
        {
            float width = Mathf.Min(Screen.width - 32, 520);
            if (captionStyle == null) captionStyle = new GUIStyle(GUI.skin.label) { fontSize = 18, wordWrap = true, alignment = TextAnchor.MiddleCenter };
            GUI.Label(new Rect(18, 14, 250, 28), "HOMELESS");
            if (GUI.Button(new Rect(Screen.width - 152, 12, 136, 42), paused ? "Resume" : "Pause")) SetPause(!paused);
            if (GUI.Button(new Rect(Screen.width - 152, 62, 136, 42), thirdPerson ? "First person" : "Third person")) thirdPerson = !thirdPerson;
            if (GUI.Button(new Rect(18, 52, 140, 42), menu ? "Close" : "People & places")) { menu = !menu; StopWalking(); }
            if (!string.IsNullOrEmpty(client.Status)) GUI.Label(new Rect(18, 104, width, 60), client.Status);
            if (!client.IsConnected && GUI.Button(new Rect(18, 168, 200, 42), "Reload connection")) client.LoadConnection();
            if (client.HasUncertainRequest)
            {
                GUI.enabled = !paused || client.PendingOperation != "manual_move";
                if (GUI.Button(new Rect(18, 216, 180, 42), "Retry same action")) client.RetryUncertain();
                GUI.enabled = true;
                if (GUI.Button(new Rect(204, 216, 150, 42), "Refresh instead")) { client.DismissUncertain(); stopRequested = true; }
            }
            if (paused) GUI.Label(new Rect(18, 270, width, 50), "Controls paused. Other inhabitants continue their lives.");
            if (!sceneryPresent) GUI.Label(new Rect(18, 325, width, 70), terrainView && terrainView.Notice.Length > 0
                ? terrainView.Notice : "Scenery for this destination has not loaded.");
            if (Time.realtimeSinceStartup < captionUntil)
                GUI.Box(new Rect(Screen.width * .12f, Screen.height - 110, Screen.width * .76f, 75), currentCaption, captionStyle);
            if (GUI.Button(new Rect(18, Screen.height - 54, 125, 38), muted ? "Enable sound" : "Mute sound"))
            { muted = !muted; voice.mute = feet.mute = muted; if (outdoorBed) outdoorBed.mute = muted; }
            if (!menu && observed != null) GUI.Label(new Rect(160, Screen.height - 50, Screen.width - 180, 40), "Move: left thumb / WASD    Look: right thumb / right mouse");
            if (!menu || observed == null || client.HasUncertainRequest) return;
            GUILayout.BeginArea(new Rect(18, 164, width, Mathf.Max(100, Screen.height - 290)), GUI.skin.box);
            menuScroll = GUILayout.BeginScrollView(menuScroll);
            GUI.enabled = !paused && client.Fresh && !client.Busy && !client.HasUncertainRequest;
            GUILayout.Label("Make yourself at home");
            if (observed.Actor.Vehicle == null)
                Action(observed.Actor.Stance == "sitting" ? "Stand" : "Sit", observed.Actor.Stance == "sitting" ? "stand" : "sit", WireJson.Map());
            var inhabitants = new List<WorldEntity>(observed.Nearby.Values);
            if (inhabitants.Count > 0)
            {
                personIndex = Math.Min(personIndex, inhabitants.Count - 1); var person = inhabitants[personIndex];
                if (GUILayout.Button("Talk to " + Display(person.Id) + "  ›", GUILayout.MinHeight(38))) personIndex = (personIndex + 1) % inhabitants.Count;
                Action("Say hello", "talk", WireJson.Map("target", person.Id, "act", "greeting"));
                Action("Ask about this place", "talk", WireJson.Map("target", person.Id, "act", "ask_place"));
                Action("Ask for a ride", "talk", WireJson.Map("target", person.Id, "act", "request_ride"));
            }
            var vehicles = new List<WorldEntity>(observed.Vehicles.Values);
            if (observed.Actor.Vehicle != null) Action("Leave vehicle", "exit", WireJson.Map());
            else if (vehicles.Count > 0)
            {
                vehicleIndex = Math.Min(vehicleIndex, vehicles.Count - 1); var vehicle = vehicles[vehicleIndex];
                if (GUILayout.Button("Vehicle: " + Display(vehicle.Id) + "  ›", GUILayout.MinHeight(38))) vehicleIndex = (vehicleIndex + 1) % vehicles.Count;
                Action("Take passenger seat", "board", WireJson.Map("vehicle", vehicle.Id, "seat", "passenger"));
                Action("Take driver seat", "board", WireJson.Map("vehicle", vehicle.Id, "seat", "driver"));
            }
            if (observed.Destinations.Count > 0)
            {
                destinationIndex = Math.Min(destinationIndex, observed.Destinations.Count - 1); var destination = observed.Destinations[destinationIndex];
                if (GUILayout.Button("Destination: " + destination.Label + "  ›", GUILayout.MinHeight(38))) destinationIndex = (destinationIndex + 1) % observed.Destinations.Count;
                double metres = GroundDistance(observed.Actor.Position, destination.Position);
                GUILayout.Label((metres / 1000).ToString("0.0") + " km away");
                string mode = "walk";
                if (observed.Actor.Vehicle != null && observed.Vehicles.TryGetValue(observed.Actor.Vehicle, out var ride)) mode = ride.Mode;
                if (mode == "taxi" || mode == "bus" || mode == "ferry")
                    Action("Agree to this route", "consent_trip", WireJson.Map("destination", destination.Id, "max_distance_m", Math.Max(100, metres * 1.5)));
                Action("Travel", "travel", WireJson.Map("destination", destination.Id, "mode", mode));
                Action("Observe place", "overlay", WireJson.Map("destination", destination.Id));
                Action("Relate places", "braid", WireJson.Map("destination", destination.Id));
            }
            if (observed.HasJourney) Action(observed.JourneyPaused ? "Resume journey" : "Pause journey", observed.JourneyPaused ? "resume" : "cancel", WireJson.Map());
            if (lifeView) lifeView.DrawActions(observed.Destinations.Count > 0 ? observed.Destinations[destinationIndex].Id : null);
            if (observed.LessonId != null)
            {
                GUILayout.Label(observed.LessonPrompt);
                foreach (string place in observed.RequiredPlaces) GUILayout.Label("Explore " + PlaceLabel(place));
                Action("Match a quarter-turn left", "learn_pattern", WireJson.Map("lesson", observed.LessonId, "answer", "quarter-turn-left"));
                var policies = new[] { "RigidCarriage", "WitnessedRelocation", "RefuseWhileOccupied" };
                var labels = new[] { "Carry occupants with their places", "Relocate occupants with a witness", "Refuse while occupied" };
                if (GUILayout.Button(labels[policyIndex] + "  ›", GUILayout.MinHeight(38))) policyIndex = (policyIndex + 1) % policies.Length;
                Action(observed.PlateRevision % 2 == 0 ? "Apply learned turn" : "Reverse learned turn", "rewrite_plate",
                    WireJson.Map("direction", observed.PlateRevision % 2 == 0 ? "forward" : "inverse", "policy", policies[policyIndex]));
            }
            GUILayout.Label("Contribute a message here"); contribution = GUILayout.TextField(contribution, 256);
            if (!string.IsNullOrEmpty(observed.Actor.Node)) Action("Publish message", "author", WireJson.Map("target", observed.Actor.Node, "text", contribution));
            GUI.enabled = true;
            foreach (var sign in observed.Signs) GUILayout.Label(Display(sign.Key) + ": " + sign.Value);
            foreach (string caption in captions) GUILayout.Label(caption);
            GUILayout.EndScrollView(); GUILayout.EndArea();
        }
        sealed class RenderedEntity
        {
            public GameObject Object;
            public Animator Animator;
            public WorldVehicleMotion Motion;
            public Renderer[] Renderers;
            public Vector3 Start, Target;
            public float SampleTime;
            public bool Initialized, Attached;
            public string Id, VehicleId, Stance, AnimationState, Gesture;
            public float GestureUntil;
            public Transform LeftHip, RightHip, DriverSeat;
            public readonly List<Transform> Seats = new List<Transform>();
        }
    }
}
