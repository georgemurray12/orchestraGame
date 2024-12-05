
let video;
let poseNet;
let poses = [];

let synth;
let isPlaying = false;
let tempo = 120; // Default tempo (BPM)
let pitchIndex = 0; // Index for current pitch
const pentatonicNotes = ["C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4"]; // Pentatonic scale
let soundLoop; // p5.SoundLoop for note playback

let clapSound;
let clappingBeat; // Loop for the clapping beat
let clapping = false; // Clapping beat state
let clapCooldown = false; // Cooldown to prevent multiple detections

let smoothedKeypoints = {}; // To store smoothed keypoints

let reverb; // Reverb effect

function preload() {
    clapSound = loadSound("clap.wav"); // Use the sound file in the same folder
}

function setup() {
    const gameContainer = document.getElementById("game-container");
    const canvas = createCanvas(windowWidth * 0.6, windowHeight * 0.6); // Scaled to 60% of window size
    canvas.parent(gameContainer); // Attach the canvas to the game container

    // Initialize video capture
    video = createCapture(VIDEO);
    video.size(width, height);
    video.hide();

    // Initialize PoseNet
    poseNet = ml5.poseNet(video, onPoseNetLoaded);
    poseNet.on("pose", results => {
        poses = results;
    });

    // Initialize Synth
    synth = new p5.PolySynth();

    // Add Reverb Effect
    reverb = new p5.Reverb();
    synth.connect(reverb);

    // Set Reverb Parameters
    reverb.amp(0.5); // Reverb amplitude
    reverb.drywet(0.4); // 40% wet signal

    // Initialize SoundLoop
    soundLoop = new p5.SoundLoop(playNote, "4n");

    // Initialize Clapping Beat Loop
    clappingBeat = new p5.SoundLoop(() => {
        clapSound.play();
    }, "4n"); // Faster claps (quarter note)

    // Set clap sound volume
    clapSound.setVolume(0.7); // Reduce volume to 70%

    // Unlock audio context
    userStartAudio().then(() => {
        console.log("Audio context started");
    });

    // Initialize smoothing object
    initializeSmoothedKeypoints();
}

function onPoseNetLoaded() {
    console.log("PoseNet model loaded");
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

function draw() {
    background(220);

    // Draw the video feed in the center
    drawVideoCentered();

    // Update and draw smoothed keypoints
    updateSmoothedKeypoints();
    drawKeypoints();

    // Handle orchestra logic
    handleOrchestraLogic();

    // Detect clapping
    detectClap();
}

function initializeSmoothedKeypoints() {
    // Initialize smoothedKeypoints for all keypoints
    for (let i = 0; i < 17; i++) {
        smoothedKeypoints[i] = { x: null, y: null, z: null };
    }
}

function updateSmoothedKeypoints() {
    const alpha = 0.7; // Smoothing factor (higher = less smoothing)

    if (poses.length > 0) {
        const keypoints = poses[0].pose.keypoints;
        for (let i = 0; i < keypoints.length; i++) {
            const kp = keypoints[i];
            if (kp.score > 0.2) {
                if (smoothedKeypoints[i].x === null) {
                    // Initialize positions on the first frame
                    smoothedKeypoints[i].x = kp.position.x;
                    smoothedKeypoints[i].y = kp.position.y;
                } else {
                    // Apply exponential moving average for smoothing
                    smoothedKeypoints[i].x = alpha * kp.position.x + (1 - alpha) * smoothedKeypoints[i].x;
                    smoothedKeypoints[i].y = alpha * kp.position.y + (1 - alpha) * smoothedKeypoints[i].y;
                }
            }
        }
    }
}

// Draw smoothed keypoints
function drawKeypoints() {
    const videoX = (width - video.width) / 2;
    const videoY = (height - video.height) / 2;

    fill(255, 0, 0);
    noStroke();

    for (let i = 0; i < Object.keys(smoothedKeypoints).length; i++) {
        const kp = smoothedKeypoints[i];
        if (kp.x !== null && kp.y !== null) {
            ellipse(kp.x + videoX, kp.y + videoY, 10, 10);
        }
    }
}

function detectClap() {
    if (poses.length > 0) {
        const leftWrist = smoothedKeypoints[9]; // Left wrist keypoint
        const rightWrist = smoothedKeypoints[10]; // Right wrist keypoint

        // Ensure the keypoints have valid confidence scores
        const leftWristConfidence = poses[0].pose.keypoints[9].score;
        const rightWristConfidence = poses[0].pose.keypoints[10].score;

        if (leftWrist && rightWrist && leftWristConfidence > 0.6 && rightWristConfidence > 0.6) {
            // Calculate the distance between the wrists
            const distance = dist(leftWrist.x, leftWrist.y, rightWrist.x, rightWrist.y);

            // Check if the distance is below the threshold and cooldown is not active
            if (distance < 75 && !clapCooldown) {
                console.log("Clapping detected");
                toggleClappingBeat();

                // Set a cooldown to prevent multiple detections
                clapCooldown = true;
                setTimeout(() => {
                    clapCooldown = false;
                }, 1500); // 1.5-second cooldown
            }
        }
    }
}

function toggleClappingBeat() {
    if (clapping) {
        clappingBeat.stop();
        console.log("Clapping beat stopped");
    } else {
        clappingBeat.start();
        console.log("Clapping beat started");
    }
    clapping = !clapping;
}

function handleOrchestraLogic() {
    if (poses.length > 0) {
        const leftWrist = smoothedKeypoints[9]; // Index for left wrist
        const rightWrist = smoothedKeypoints[10]; // Index for right wrist

        if (leftWrist && rightWrist) {
            // Start orchestra when both wrists are above the head
            if (leftWrist.y < height / 4 && rightWrist.y < height / 4) {
                if (!isPlaying) {
                    startOrchestra();
                }
            }
            // Stop orchestra when both wrists are below the waist
            else if (leftWrist.y > (3 * height) / 4 && rightWrist.y > (3 * height) / 4) {
                if (isPlaying) {
                    stopOrchestra();
                }
            }

            // Adjust tempo based on right wrist vertical position
            let newTempo = map(rightWrist.y, 0, height, 180, 60); // Inverse mapping
            newTempo = constrain(newTempo, 60, 180);
            if (newTempo !== tempo) {
                console.log(`Tempo updated: ${tempo} -> ${newTempo}`);
                tempo = newTempo;
                if (soundLoop.isPlaying) {
                    soundLoop.bpm = tempo; // Update loop BPM
                }
            }

            // Adjust pitch based on left wrist vertical position
            let newPitchIndex = floor(map(leftWrist.y, height, 0, 0, pentatonicNotes.length));
            newPitchIndex = constrain(newPitchIndex, 0, pentatonicNotes.length - 1);
            if (newPitchIndex !== pitchIndex) {
                console.log(`Pitch updated: ${pentatonicNotes[pitchIndex]} -> ${pentatonicNotes[newPitchIndex]}`);
                pitchIndex = newPitchIndex;
            }
        }
    }
}

function drawVideoCentered() {
    const videoX = (width - video.width) / 2;
    const videoY = (height - video.height) / 2;
    image(video, videoX, videoY, video.width, video.height);
}

function startOrchestra() {
    if (!soundLoop.isPlaying) {
        isPlaying = true;
        soundLoop.bpm = tempo; // Set initial BPM
        soundLoop.start();
        console.log("Orchestra started");
    }
}

function stopOrchestra() {
    if (soundLoop.isPlaying) {
        isPlaying = false;
        soundLoop.stop();
        console.log("Orchestra stopped");
    }
}

function playNote() {
    const note = pentatonicNotes[pitchIndex];
    synth.play(note, 0.5, 0, "8n"); // Note, velocity, delay, duration
    console.log(`Playing note: ${note}, Tempo: ${tempo}`);
}

