using UnityEngine;

namespace Homeless.Unity
{
    // Operator art-review controller. This is not the required third-person humanoid gameplay.
    [RequireComponent(typeof(CharacterController))]
    public sealed class ReviewWalker : MonoBehaviour
    {
        public Camera view;
        public float speed = 2.8f;
        public float sensitivity = 0.12f;
        public bool reducedMotion = true;
        CharacterController body;
        float yaw, pitch, vertical;
        int moveFinger = -1, lookFinger = -1;
        Vector2 moveOrigin, moveInput, previousMouse;
        Vector3 inspectionSpawn;
        bool paused;
        bool outsideReviewArea;
        void Awake()
        {
            body = GetComponent<CharacterController>();
            if (!view) view = GetComponentInChildren<Camera>();
            yaw = transform.eulerAngles.y;
            Application.targetFrameRate = 30;
            previousMouse = Input.mousePosition;
            inspectionSpawn = transform.position;
        }
        void Update()
        {
            if (Input.GetKeyDown(KeyCode.Escape)) SetPause(!paused);
            if (Input.GetKeyDown(KeyCode.R)) ResetInspection();
            if (transform.position.y < inspectionSpawn.y - 6)
            {
                outsideReviewArea = true;
                SetPause(true);
            }
            if (paused) return;
            Vector2 move = new Vector2((Input.GetKey(KeyCode.D)?1:0)-(Input.GetKey(KeyCode.A)?1:0),
                (Input.GetKey(KeyCode.W)?1:0)-(Input.GetKey(KeyCode.S)?1:0));
            Vector2 look = Vector2.zero;
            Vector2 mouse = Input.mousePosition;
            if (Input.GetMouseButton(1) && !Input.GetMouseButtonDown(1)) look = mouse - previousMouse;
            previousMouse = mouse;
            ReadTouch(ref move, ref look);
            yaw += look.x * sensitivity;
            pitch = Mathf.Clamp(pitch - look.y * sensitivity, -70, 70);
            transform.rotation = Quaternion.Euler(0, yaw, 0);
            view.transform.localRotation = Quaternion.Euler(pitch, 0, 0);
            Vector3 desired = transform.TransformDirection(new Vector3(move.x,0,move.y));
            desired = Vector3.ClampMagnitude(desired,1) * speed;
            vertical = body.isGrounded && vertical < 0 ? -2 : Mathf.Max(-30,vertical + Physics.gravity.y * Time.deltaTime);
            body.Move((desired + Vector3.up * vertical) * Mathf.Min(Time.deltaTime,0.05f));
        }
        void ReadTouch(ref Vector2 move, ref Vector2 look)
        {
            foreach (Touch touch in Input.touches)
            {
                if (touch.phase == TouchPhase.Began)
                {
                    if (touch.position.x < Screen.width * 0.5f && moveFinger < 0) { moveFinger=touch.fingerId;moveOrigin=touch.position; }
                    else if(lookFinger<0) lookFinger=touch.fingerId;
                }
                bool ended=touch.phase==TouchPhase.Ended||touch.phase==TouchPhase.Canceled;
                if(touch.fingerId==moveFinger)
                {
                    moveInput=ended?Vector2.zero:Vector2.ClampMagnitude((touch.position-moveOrigin)/Mathf.Max(80,Screen.height*0.12f),1);
                    if(ended)moveFinger=-1;
                }
                if(touch.fingerId==lookFinger){if(!ended)look+=touch.deltaPosition;if(ended)lookFinger=-1;}
            }
            move+=moveInput;
        }
        void OnApplicationFocus(bool focused){if(!focused)SetPause(true);}
        void OnApplicationPause(bool suspended){if(suspended)SetPause(true);}
        void SetPause(bool value){paused=value;moveFinger=lookFinger=-1;moveInput=Vector2.zero;}
        public void ResetInspection()
        {
            // Explicit operator reset of the review fixture, never a gameplay transport effect.
            body.enabled=false;
            transform.position=inspectionSpawn;
            vertical=0;
            body.enabled=true;
            outsideReviewArea=false;
            SetPause(false);
        }
        void OnGUI()
        {
            // Explicitly an internal review build; operator metadata is absent from product gameplay.
            GUI.Label(new Rect(18,16,700,32),"HOMELESS · source art review · native quality unverified");
            GUI.Label(new Rect(18,45,700,28),"WASD + right-drag · touch: left move / right look");
            if(GUI.Button(new Rect(Screen.width-150,16,130,48),paused?"Resume":"Pause"))SetPause(!paused);
            if(GUI.Button(new Rect(Screen.width-150,76,130,48),"Reset view"))ResetInspection();
            if(outsideReviewArea)GUI.Label(new Rect(18,80,700,36),"Review boundary reached. Use Reset view or R to return to the café.");
        }
    }
}
