using UnityEngine;

namespace Homeless.Unity
{
    // Original synthesized audio experiments; native audibility/occlusion quality is unverified.
    [RequireComponent(typeof(CharacterController))]
    public sealed class ReviewSoundscape : MonoBehaviour
    {
        public AudioClip leftFootstep, rightFootstep;
        public AudioSource outdoorBed, arrivalMotif;
        AudioSource footsteps;
        CharacterController controller;
        Vector3 previous;
        float distance;
        bool nextLeft=true, muted;
        void Start()
        {
            controller=GetComponent<CharacterController>();previous=transform.position;
            footsteps=gameObject.AddComponent<AudioSource>();footsteps.playOnAwake=false;footsteps.spatialBlend=1;
            footsteps.minDistance=1;footsteps.maxDistance=12;footsteps.volume=.4f;footsteps.dopplerLevel=0;
            if(outdoorBed)outdoorBed.Play();if(arrivalMotif)arrivalMotif.Play();
        }
        void Update()
        {
            Vector3 displacement=transform.position-previous;previous=transform.position;
            if(displacement.magnitude>2){distance=0;return;} // review reset is not locomotion
            displacement.y=0;
            if(!controller.isGrounded){distance=0;return;}
            distance+=displacement.magnitude;
            if(distance>=.7f)
            {
                distance%=.7f;var clip=nextLeft?leftFootstep:rightFootstep;nextLeft=!nextLeft;
                if(clip&&!muted)footsteps.PlayOneShot(clip);
            }
        }
        void OnGUI()
        {
            if(GUI.Button(new Rect(18,Screen.height-66,160,48),muted?"Enable audio":"Mute audio"))
            {
                muted=!muted;if(footsteps)footsteps.mute=muted;if(outdoorBed)outdoorBed.mute=muted;if(arrivalMotif)arrivalMotif.mute=muted;
            }
        }
        void OnApplicationPause(bool paused)
        {if(outdoorBed){if(paused)outdoorBed.Pause();else outdoorBed.UnPause();}}
    }
}
