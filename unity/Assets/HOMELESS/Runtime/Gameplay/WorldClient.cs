using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

namespace Homeless.Unity.Gameplay
{
    // The server admits effects. This adapter never predicts a commit or silently changes its retry identity.
    public sealed class WorldClient : MonoBehaviour
    {
        public WorldSnapshot Snapshot { get; private set; }
        public string Status { get; private set; } = "Connect to your world to begin.";
        public bool Busy { get; private set; }
        public bool HasUncertainRequest => pending != null;
        public bool IsConnected => connection != null;
        public string PendingOperation => pending == null ? null : pending.Operation;
        public bool Fresh => Snapshot != null && Time.realtimeSinceStartup - lastObservation < 3;
        public long Requests { get; private set; }
        public long Refusals { get; private set; }
        public float LastRequestMilliseconds { get; private set; }
        public string TerrainStatus { get; private set; } = "";
        public event Action<WorldSnapshot> Observed;
        public event Action<string, Dictionary<string, object>> Committed;
        WorldConnection connection;
        WorldProposal pending;
        float nextPoll, lastObservation = -100;
        float nextTerrain;
        bool terrainBusy;

        void Start() { LoadConnection(); }
        void Update()
        {
            if (connection != null && !Busy && Time.realtimeSinceStartup >= nextPoll)
            { nextPoll = Time.realtimeSinceStartup + .2f; StartCoroutine(Request(null)); }
        }
        public void LoadConnection()
        {
            if (Busy || pending != null) { Status = "Resolve the pending action before changing connection."; return; }
            connection = null; Snapshot = null; lastObservation = -100;
            try
            {
                string path = Environment.GetEnvironmentVariable("HOMELESS_CONNECTION_FILE");
                if (string.IsNullOrEmpty(path)) path = Path.Combine(Application.persistentDataPath, "connection.json");
                if (!File.Exists(path)) { Status = "World connection is not configured."; return; }
                if (new FileInfo(path).Length > 4096) throw new FormatException("Configuration size refused");
                connection = WorldConnection.Parse(File.ReadAllText(path, new UTF8Encoding(false, true)));
                Snapshot = null; lastObservation = -100; nextPoll = 0; Status = "Connecting…";
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException || error is FormatException || error is DecoderFallbackException)
            { connection = null; Status = "World connection could not be loaded."; }
        }
        public bool Propose(string operation, Dictionary<string, object> input)
        {
            if (connection == null || Busy || !Fresh || pending != null) return false;
            pending = new WorldProposal(operation, input, Snapshot.Revision);
            StartCoroutine(Request(pending)); return true;
        }
        public void RetryUncertain()
        { if (!Busy && connection != null && pending != null) StartCoroutine(Request(pending)); }
        public void DismissUncertain()
        {
            if (Busy) return;
            // A lost response may already have committed. Dismissal never undoes it.
            pending = null; nextPoll = 0; Status = "Refreshing the world. A previous action may already have happened.";
        }
        public bool RequestTerrain(WorldPoint center, Action<WorldTerrain> complete)
        {
            if (connection == null || terrainBusy || Time.realtimeSinceStartup < nextTerrain) return false;
            terrainBusy = true; nextTerrain = Time.realtimeSinceStartup + 2;
            StartCoroutine(TerrainRequest(center, connection, complete)); return true;
        }
        IEnumerator TerrainRequest(WorldPoint center, WorldConnection credentials, Action<WorldTerrain> complete)
        {
            WorldTerrain terrain = null;
            try
            {
                string path = "/r/world/terrain?lat=" + center.Latitude.ToString("R", CultureInfo.InvariantCulture)
                    + "&lon=" + center.Longitude.ToString("R", CultureInfo.InvariantCulture) + "&width=33&span=10000";
                using (var download = new BoundedDownload(262144))
                using (var request = new UnityWebRequest(credentials.Origin + path, "GET"))
                {
                    Requests++; request.downloadHandler = download; request.disposeDownloadHandlerOnDispose = false;
                    request.timeout = 10; request.redirectLimit = 0;
                    request.SetRequestHeader("Authorization", "Bearer " + credentials.Token);
                    request.SetRequestHeader("Accept", "application/purl+json");
                    yield return request.SendWebRequest();
                    if (request.responseCode == 200 && request.result == UnityWebRequest.Result.Success && !download.Exceeded
                        && ReferenceEquals(credentials, connection))
                    {
                        try
                        {
                            string media = (request.GetResponseHeader("Content-Type") ?? "").Split(';')[0].Trim();
                            if (media != "application/json" && media != "application/purl+json") throw new FormatException("Terrain media refused");
                            terrain = WorldTerrain.Parse(download.Text());
                            if (WorldTerrain.Distance(center, terrain.Center) > .1) throw new FormatException("Terrain request center mismatch");
                            TerrainStatus = WorldTerrain.ResolutionNotice;
                        }
                        catch (Exception error) when (error is FormatException || error is DecoderFallbackException || error is ArgumentException)
                        { terrain = null; TerrainStatus = "Landscape source response could not be verified."; }
                    }
                    else TerrainStatus = "Landscape source unavailable; last verified surface retained.";
                }
            }
            finally { terrainBusy = false; nextTerrain = Time.realtimeSinceStartup + 2; }
            complete?.Invoke(terrain);
        }
        IEnumerator Request(WorldProposal proposal)
        {
            Busy = true; Requests++;
            float start = Time.realtimeSinceStartup;
            try
            {
                string path = proposal == null ? "/r/world" : "/r/world/ops/" + proposal.Operation;
                using (var download = new BoundedDownload())
                using (var request = new UnityWebRequest(connection.Origin + path, proposal == null ? "GET" : "POST"))
                {
                    request.downloadHandler = download; request.disposeDownloadHandlerOnDispose = false;
                    request.timeout = 5; request.redirectLimit = 0;
                    request.SetRequestHeader("Authorization", "Bearer " + connection.Token);
                    request.SetRequestHeader("Accept", "application/purl+json");
                    if (proposal != null)
                    {
                        request.uploadHandler = new UploadHandlerRaw(new UTF8Encoding(false, true).GetBytes(proposal.Body));
                        request.SetRequestHeader("Content-Type", "application/json");
                        request.SetRequestHeader("Idempotency-Key", proposal.RequestId);
                    }
                    yield return request.SendWebRequest();
                    LastRequestMilliseconds = (Time.realtimeSinceStartup - start) * 1000;
                    long status = request.responseCode;
                    if (status == 400 || status == 401 || status == 403 || status == 409 || status == 404)
                    {
                        Refusals++; if (proposal != null) pending = null;
                        if (status == 401) { connection = null; lastObservation = -100; }
                        Status = status == 409 ? "The world changed. Refreshing; try your action again."
                            : status == 401 ? "Your world session is unavailable. Reload the connection after renewing it."
                            : "That action is unavailable here.";
                        nextPoll = Time.realtimeSinceStartup + .2f; yield break;
                    }
                    if (request.result != UnityWebRequest.Result.Success || status != 200 || download.Exceeded)
                    {
                        Status = proposal == null ? "Connection interrupted. Showing the last observed world."
                            : "The action's result is unknown. Retry the same action or refresh.";
                        nextPoll = Time.realtimeSinceStartup + 1; yield break;
                    }
                    try
                    {
                        string media = (request.GetResponseHeader("Content-Type") ?? "").Split(';')[0].Trim();
                        if (media != "application/json" && media != "application/purl+json") throw new FormatException("Media type refused");
                        string body = download.Text();
                        if (proposal == null)
                        {
                            var snapshot = WorldSnapshot.Parse(body);
                            if (Snapshot != null && snapshot.Revision < Snapshot.Revision) throw new FormatException("Revision rollback requires explicit recovery");
                            Snapshot = snapshot; lastObservation = Time.realtimeSinceStartup;
                            if (pending == null) Status = "";
                            Observed?.Invoke(snapshot);
                        }
                        else
                        {
                            var result = WireJson.Object(WireJson.Parse(body));
                            if (WireJson.Text(WireJson.Get(result, "status")) != "COMMITTED"
                                || WireJson.Integer(WireJson.Get(result, "revision")) != proposal.BaseRevision + 1)
                                throw new FormatException("Commit receipt refused");
                            pending = null; Status = ""; nextPoll = 0; lastObservation = -100;
                            Committed?.Invoke(proposal.Operation, WireJson.Object(WireJson.Get(result, "data")));
                        }
                    }
                    catch (Exception error) when (error is FormatException || error is DecoderFallbackException || error is ArgumentException)
                    { Status = "The world response could not be verified. Your last observation is retained."; nextPoll = Time.realtimeSinceStartup + 1; }
                }
            }
            finally { Busy = false; }
        }
        sealed class BoundedDownload : DownloadHandlerScript
        {
            readonly MemoryStream buffer = new MemoryStream();
            readonly int limit;
            public bool Exceeded { get; private set; }
            public BoundedDownload(int limit = 1048576) : base(new byte[8192]) { this.limit = limit; }
            protected override void ReceiveContentLengthHeader(ulong length) { if (length > (ulong)limit) Exceeded = true; }
            protected override bool ReceiveData(byte[] data, int length)
            {
                if (Exceeded || data == null || length < 0 || buffer.Length + length > limit) { Exceeded = true; return false; }
                buffer.Write(data, 0, length); return true;
            }
            public string Text()
            {
                if (Exceeded || buffer.Length == 0) throw new FormatException("Response budget refused");
                return new UTF8Encoding(false, true).GetString(buffer.ToArray());
            }
        }
    }
}
