/* globals vec3, mat4, deg2rad, rad2deg, getClosestCurvePointOnTrack */
// Time Trial Racing using WebGL
// AUTHORS: Jonah Beers and Mark Morykan
'use strict';

// Global canvas context variables
let gl;

// Audio
let context;
let audioBuffer;

// Game time data
let gameStartTime = 0;
let gamePausedTime = 0;
let gameCurrTime = 0;

// Game state data
let atTitleScreen = true;
let inHelpMenu = false;
let hasStarted = false;
let isPaused = false;
let isIdle = true;
let hasCrashed = false;
let hasWon = false;
let hasReachedCheckpoint = false;
let turningWhileIdle = {isTurning: false, direction: ""};

// Physics
const maxPower = 0.01; 
const maxReverse = -0.002;
const powerFactor = 0.00001;
const reverseFactor = -0.000005;

// Game controls
let forward = 'w';
let backward = 's';
let right = 'a';
let left = 'd';
let controls;

// Track render and movement data
let track = {vertices: [], indices: [], curve_verts: [], curve_lines: []};
let rotation = [0, 0, 0];
let previousYRotation = 0;
let previousXRotation = 0;
let trackPosition = [0, -0.15, -.25]; 
let positionMatrix;

// Car data
let car = {vertices: [], indices: []};
let carPosition = [.01, -.08, -.155]; 
let carBox;

// Car scale factor
let mustangScale = 0.018;


// Once the document is fully loaded run this init function.
window.addEventListener('load', function init() {
    // Get the HTML5 canvas object from it's ID
    const canvas = document.getElementById('webgl-canvas');
    if (!canvas) { window.alert('Could not find #webgl-canvas'); return; }

    // Get the canvas context (save into global variables)
    gl = canvas.getContext('webgl2');
    if (!gl) { window.alert("WebGL isn't available"); return; }

    // Configure WebGL
    gl.viewport(0, 0, canvas.width, canvas.height); // the region of the canvas we want to draw on
    gl.clearColor(0.0, 0.5, 1.0, 0.7); // setup the background color
    gl.enable(gl.DEPTH_TEST);

    // Initialize the WebGL program and data
    gl.program = initProgram();

    // Get HTML elements
    gl.timer = document.getElementById("game-time");
    gl.message = document.getElementById("message");

    // Set up title screen
    gl.menu = document.getElementById("menu");
    onWindowResize();
    
    // Load models and textures and wait for them all to complete
    Promise.all([
        loadModel('racetracks/track1/track1.json', track),
        loadModel('racecars/1967-shelby-ford-mustang/mustang.json', car),
        ...initTextures()
    ]).then(
        models => {
            // Models is an array of all of the loaded models and textures
            gl.models = models;
            carBox = calculateCarBox();
            initEvents();
        }
    );

    // Set initial uniform values
    gl.uniform1i(gl.program.uTexture, 0);
    gl.uniform1i(gl.program.uModeThree, 0);
    gl.uniform4f(gl.program.uLight, 0, 20, 0, 1);
    updateModelViewMatrix(mat4.create());
});


/**
 * Initializes the WebGL program.
 */
function initProgram() {
    // Compile shaders
    // Vertex Shader
    let vert_shader = compileShader(gl, gl.VERTEX_SHADER,
        `#version 300 es
        precision mediump float;

        uniform mat4 uModelViewMatrix;
        uniform mat4 uProjectionMatrix;
        uniform vec4 uLight;

        in vec4 aPosition;
        in vec3 aNormal;
        in vec2 aTexCoord;

        out vec3 vNormalVector;
        out vec3 vLightVector;
        out vec3 vEyeVector;
        out vec2 vTexCoord;

        void main() {
            vec4 P = uModelViewMatrix * aPosition;
            vNormalVector = mat3(uModelViewMatrix) * aNormal;
            vLightVector = uLight.w == 1.0 ? P.xyz - uLight.xyz : uLight.xyz;
            vEyeVector = vec3(0, 0, 1) - P.xyz;
            gl_Position = uProjectionMatrix * P;
            vTexCoord = aTexCoord;
        }`
    );
    // Fragment Shader
    let frag_shader = compileShader(gl, gl.FRAGMENT_SHADER,
        `#version 300 es
        precision mediump float;

        // Light and material properties
        const vec3 lightColor = vec3(1, 1, 1);
        const float materialAmbient = 1.0;
        const float materialDiffuse = 0.8;
        const float materialSpecular = 0.5;
        const float materialShininess = 10.0;
            
        // Vectors (varying variables from vertex shader)
        in vec3 vNormalVector;
        in vec3 vLightVector;
        in vec3 vEyeVector;
        in vec2 vTexCoord;

        // Uniforms
        uniform vec3 uLightDirection;
        uniform sampler2D uTexture;
        uniform bool uModeThree;
        
        out vec4 fragColor;

        void main() {
            // Normalize vectors
            vec3 N = normalize(vNormalVector);
            vec3 L = normalize(vLightVector);
            vec3 E = normalize(vEyeVector);

            // Compute lighting
            float diffuse = dot(-L, N);
            float specular = 0.0;
            if (diffuse < 0.0) {
                diffuse = 0.0;
            } else {
                vec3 R = reflect(L, N);
                specular = pow(max(dot(R, E), 0.0), materialShininess);
            }

            // Compute color
            vec4 color = texture(uTexture, vTexCoord);
            float light = 0.0;
            fragColor.rgb = ((materialAmbient + materialDiffuse * diffuse) * 
                color.rgb + materialSpecular * specular) * lightColor;

            // If Impossible mode, use a headlight 
            if (uModeThree) {
                float limit = 0.82; // 35 degree range of light                
                float dotFromDirection = dot(L, uLightDirection);
                if (dotFromDirection >= limit) { // Inside the range of light
                    light = dot(N, L);
                }
                fragColor.rgb *= light;
            }
            fragColor.a = 1.0;
        }`
    );

    // Link the shaders into a program and use them with the WebGL context
    let program = linkProgram(gl, vert_shader, frag_shader);
    gl.useProgram(program);
    
    // Get the attribute indices
    program.aPosition = gl.getAttribLocation(program, 'aPosition');
    program.aNormal = gl.getAttribLocation(program, 'aNormal');
    program.aTexCoord = gl.getAttribLocation(program, 'aTexCoord');

    // Get the uniform indices
    program.uModelViewMatrix = gl.getUniformLocation(program, 'uModelViewMatrix');
    program.uProjectionMatrix = gl.getUniformLocation(program, 'uProjectionMatrix');
    program.uLight = gl.getUniformLocation(program, 'uLight');
    program.uLightDirection = gl.getUniformLocation(program, 'uLightDirection');
    program.uTexture = gl.getUniformLocation(program, 'uTexture');
    program.uModeThree = gl.getUniformLocation(program, 'uModeThree');

    return program;
}

/**
 * Load a texture onto the GPU.
 */
function loadTexture(img, index) {

    let texture = gl.createTexture(); // create a texture resource on the GPU
    gl.activeTexture(gl['TEXTURE'+index]); // set the current texture that all following commands will apply to
    gl.bindTexture(gl.TEXTURE_2D, texture); // assign our texture resource as the current texture
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // tell WebGL to flip the image vertically 

    // Load the image data into the texture
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    // Setup options for downsampling and upsampling the image data
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Cleanup and return
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
}

/**
 * Return a Promise to load the texture
 */
function loadImageAsTexture(img_url, index) {
    return new Promise(resolve => {
        const image = new Image();
        image.addEventListener('load', () => {
            resolve(loadTexture(image, index));
        });
        image.src = img_url;
    });
}


/**
 * Initialize the texture buffers.
 */
function initTextures() {
    let trackImage = loadImageAsTexture('textures/rainbow_road.jpg', 0);
    let carImage = loadImageAsTexture('textures/Blacktop_New.jpg', 1); 
    return [trackImage, carImage];
}

/**
 * Set up arrays in order of their provided indices
 */
function getFormattedVertices(coords, inds, step) {
    let formattedCoords = [];
    for (let i = 0; i < inds.length; i++) {
        let index = inds[i];
        let verts = coords.subarray(index*step, index*step+step); 
        formattedCoords.push(...verts);
    }
    return Float32Array.from(formattedCoords); 
}

/**
 * Load a model from a file into a VAO and return the VAO and the number of vertices.
 */
function loadModel(filename, model) {
    return fetch(filename)
        .then(r => r.json())
        .then(raw_model => {
            // Create and bind the VAO
            if (typeof model.curve_verts !== "undefined") {
                track.curve_verts = Float32Array.from(raw_model.curve_verts);
                track.curve_lines = Float32Array.from(raw_model.curve_lines);
            }
            // Format all vertices in the correct order
            let formattedVerts = model.vertices = getFormattedVertices(Float32Array.from(raw_model.vertices), raw_model.indices, 3);
            let formattedTexCoords = getFormattedVertices(Float32Array.from(raw_model.texture), raw_model.texture_inds, 2);
            let formattedNormals = getFormattedVertices(Float32Array.from(raw_model.normals), raw_model.normal_indices, 3);

            return createObject(formattedVerts, formattedTexCoords, formattedNormals);             
        })
        .catch(console.error);
}


/**
 * Creates a VAO containing the coordinates, colors, and indices provided
 */
function createObject(verts, tex_coords, normals) {
    // Create and bind VAO
    let vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Load the vertex coordinate data onto the GPU and associate with attribute
    let posBuffer = gl.createBuffer(); // create a new buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer); // bind to the new buffer
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW); // load the data into the buffer
    gl.vertexAttribPointer(gl.program.aPosition, 3, gl.FLOAT, false, 0, 0); // associate the buffer with "aPosition" as length-3 vectors of floats
    gl.enableVertexAttribArray(gl.program.aPosition); // enable this set of data

    let normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer); 
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW); 
    gl.vertexAttribPointer(gl.program.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.program.aNormal);

    let texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, tex_coords, gl.STATIC_DRAW);
    gl.vertexAttribPointer(gl.program.aTexCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(gl.program.aTexCoord);

    // Cleanup
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // Return the VAO and number of indices
    return [vao, verts.length/3];
}


/**
 * Initialize event handlers
 */
function initEvents() {
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', onKeyDown); 
    window.addEventListener('keyup', onKeyUp); 
}

/**
 * Create audio context on mode selection and load song
 */
function startPlaying() {
    hasStarted = true;
    gl.menu.remove();

    // Soundtrack while playing
    context = new (window.AudioContext || window.webkitAudioContext);
    context.resume();
    
    loadSound();
}

/**
 * Set the controls for the car
 */
function setControls() {
    controls = {
        [forward]: {pressed: false, value: 0}, 
        [right]: {pressed: false, value: -.5},
        [backward]: {pressed: false, value: 0}, 
        [left]: {pressed: false, value: .5},
    };
}


/**
 * Helper function to setup game when mode is selected
 */
function initializeGame() {
    setControls();
    startPlaying()
    render();
}


/**
 * First mode was selected
 */
function normalRacingMode() {
    initializeGame();
}

/**
 * Second mode was selected.
 * Randomize the controls before rendering.
 */
function randomRacingMode() {
    let keys = ['w', 's', 'a', 'd'];
    let newControls = [];

    while (keys.length !== 0) {
        let index = Math.floor(Math.random()*keys.length);
        let control = keys[index];
        newControls.push(control);
        keys.splice(index, 1);
    }
    [forward, right, backward, left] = newControls;
    initializeGame();
}

/**
 * Third mode was selected.
 * Set background color to black and update light position to front of car.
 */
function nighttimeRacingMode() {
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.timer.style.color = "white";
    gl.uniform4f(gl.program.uLight, ...carPosition, 1);
    let m = mat4.lookAt(mat4.create(), carPosition, [carPosition[0], -0.15, -0.4], [0,0,1]);
    gl.uniform3f(gl.program.uLightDirection, -m[8], -m[9], -m[10]);
    gl.uniform1i(gl.program.uModeThree, 1);
    initializeGame();
}

/**
 * Displays the mode selection menu
 */
function modeSelect() {
    resizeImage("title-screen/choosedifficulty.png");
    atTitleScreen = false;
}

/***
 * Event handler for when key is pressed down.
 */
function onKeyDown(e) {
    if (!hasStarted) return; 
    let key = e.key;
    if (controls[key]) { 
        if (hasStarted && gameStartTime === 0) { // start the timer when user starts driving
            gameStartTime = new Date();
        }
        if ((key === right || key === left) && isIdle) { // trying to turn while not moving forward/backward
            controls[key].pressed = false; // key is not being pressed or else updateposition will turn car
            turningWhileIdle.isTurning = true; 
            turningWhileIdle.direction = key; // save direction car is trying to turn until moving again
            return;
        }
        controls[key].pressed = true;
        isIdle = false;
        // If car was trying to turn when was idle and still is, update the direction it wants to turn
        if ((key === forward || key === backward) && turningWhileIdle.isTurning) controls[turningWhileIdle.direction].pressed = true;
    }
}


/**
 * Event handler for when a key is lifted.
 */
function onKeyUp(e) {
    let key = e.key;
    if (atTitleScreen) { // Any key when on title screen
        modeSelect();
    } else if (!hasStarted) { // Menu screens
        if (key === '1') normalRacingMode();
        else if (key === '2') randomRacingMode();
        else if (key === '3') nighttimeRacingMode();
        else if (key === 'h' && !inHelpMenu) helpMenu(); 
        else if (key === 'b' && inHelpMenu) exitHelpMenu();
    } else { // in the game
        if (key === 'p') { 
            pause(); 
        } else if (controls[key]) {
            controls[key].pressed = false;
            // If car is now idle, make sure that the car is not turning
            if ((key === forward || key === backward) && turningWhileIdle.isTurning) controls[turningWhileIdle.direction].pressed = false;
            // Remove direction car was trying to turn while idle
            if (turningWhileIdle.direction === key) turningWhileIdle.isTurning = false;
        }
    }
}

/**
 * Handles the physics for car movement.
 */
function accelerate() {
    let forwardVel = controls[forward].value;
    let backwardVel = controls[backward].value;
    if (!isPaused) { // don't accelerate car while idle
        if (controls[forward].pressed) { // if car is moving forward, increase speed steadily up to max
            if (forwardVel < maxPower) controls[forward].value = round(forwardVel, powerFactor);
        } else if (!controls[forward].pressed) { // if car is not moving forward, decrease speed steadily down to 0
            if (forwardVel > 0) controls[forward].value = round(forwardVel, -powerFactor);
        }

        if (controls[backward].pressed) { // if car is moving backward, increase speed steadily up to max
            if (hasCrashed) controls[backward].value = round(backwardVel, -reverseFactor*5);
            else if (backwardVel > maxReverse) controls[backward].value = round(backwardVel, reverseFactor);
        } else if (!controls[backward].pressed) { // if car is not moving backward, decrease speed steadily down to 0
            if (backwardVel < 0) controls[backward].value = round(backwardVel, -reverseFactor);
        }
    }
    if (controls[forward].value === 0 && controls[backward].value === 0) isIdle = true; // car is idle when not moving forward or backward
}


/**
 * Round to nearest millionth place so 
 * maxPower and maxReverse can be reached.
 */
function round(value, factor) {
    return Math.round(1000000*(value+factor)) / 1000000;
}


/**
 * Displays image for controls
 */
function helpMenu() {
    inHelpMenu = true;
    resizeImage("title-screen/howtoplay.png");
}


/**
 * Displays mode selection screen
 */
function exitHelpMenu() {
    inHelpMenu = false;
    resizeImage("title-screen/choosedifficulty.png");
}


/**
 * Event handler for when user presses 'p' 
 * to pause the game state.
 */
function pause() {
    if (isPaused) {
        window.addEventListener('keydown', onKeyDown);
        gl.message.textContent = ""; // no text in div when not paused
        isPaused = false;
    } else {
        window.removeEventListener('keydown', onKeyDown);
        Object.keys(controls).forEach(key => {controls[key].pressed = false});
        gl.message.textContent = "PAUSED";
        isPaused = true;
    }
}


/**
 * Displays the current time the
 * player has been driving for.
 */
function updateTimer() {
    calculateElapsedTime();
    let elapsedTime = Math.round((gameCurrTime - gameStartTime)/ 1000);
    let minutes = Math.floor(elapsedTime / 60);
    if (minutes < 10) minutes = "0"+minutes;
    let seconds = elapsedTime % 60;
    if (seconds < 10) seconds = "0"+seconds;
    gl.timer.textContent = minutes+":"+seconds;
}


/**
 * Gets the current time (not including time paused) while 
 * the user is playing. If paused, keeps track of the paused time.
 */
function calculateElapsedTime() {
    let currTime = new Date();
    if (isPaused) gamePausedTime = currTime - gameCurrTime;
    if (!hasWon) gameCurrTime = currTime - gamePausedTime;
}


/**
 * Checks if the distance between the track position and the 
 * player position is around a certain checkpoint on the track.
 */
function checkReachedCheckpoint() {
    if (vec3.distance(vec3.create(), trackPosition, carPosition) > 3.5) hasReachedCheckpoint = true;
}


/**
 * Checks if the distance between the track position and the 
 * player position is around the starting point on the track.
 * Ends the game by disabling controls and displaying message.
 */
function checkReachedFinish() {
    if (vec3.distance(vec3.create(), trackPosition, carPosition) < 0.3) {
        window.removeEventListener('keydown', onKeyDown); 
        hasWon = true;
        gl.message.textContent = "COMPLETE!";
    }
}


/**
 * Set up music soundtrack and load sounds into audio buffer
 */
function loadSound() {
    let audioTracks = ["CrazyFrog", "ShootingStars"]; // can add more songs
    let audioURL="sound-effects/"+audioTracks[Math.floor(Math.random() * audioTracks.length)]+".mp3";

    // Create a new request
    let request = new XMLHttpRequest();
    request.open("GET", audioURL, true);
    request.responseType = 'arraybuffer';
    request.addEventListener('load', () => {
        // Take audio from http request and decode it in an audio buffer
        context.decodeAudioData(request.response, (buffer) => { 
            audioBuffer = buffer;
            if (audioBuffer) playSound();
        });
    });
    request.send();
}


/**
 * Play whichever song has randomly been loaded into the buffer
 */
function playSound() {
    // Create source node
    let source = context.createBufferSource();
    // Pass in file
    source.buffer = audioBuffer;
    // Create gain node and connect 
    let gainNode = context.createGain();
    gainNode.gain.value = 0.05; // 5% volume
    gainNode.connect(context.destination);
    source.connect(gainNode); 
    // Start playing
    source.start(0);
    source.addEventListener('ended', () => { // load new song when track ends
        loadSound();
    });
}


/**
 * Find the 4 corner vertices of the car model 
 * to form a "box" that the car is in.
 */
function calculateCarBox() {
    let verts = car.vertices;
    let corners = {maxX: verts[0], minX: verts[0], maxZ: verts[2], minZ: verts[2]};
    for (let i = 3; i < verts.length; i += 3) {
        if (verts[i] > corners.maxX) corners.maxX = verts[i] + carPosition[0];
        else if (verts[i] < corners.minX) corners.minX = verts[i] + carPosition[0];
        if (verts[i+2] > corners.maxZ) corners.maxZ = verts[i+2] + carPosition[2];
        else if (verts[i+2] < corners.minZ) corners.minZ = verts[i+2] + carPosition[2];
    }
    
    // Scale the vertices appropriately
    Object.keys(corners).forEach(key => {
        corners[key] *= mustangScale;
    });

    return corners;
}

/**
 * Set screen to be displayed
 */
function resizeImage(src) {
    let windowWidth = window.innerWidth+"px";
    let windowHeight = window.innerHeight+"px";
    gl.menu.style.width = windowWidth;
    gl.menu.style.height = windowHeight;
    gl.menu.src = src;
}


/**
 * Keep the canvas or image sized to the window.
 */
function onWindowResize() {
    if (atTitleScreen) {
        resizeImage("title-screen/timetrialracing.png");
    } else if (!hasStarted && !inHelpMenu) {
        resizeImage("title-screen/choosedifficulty.png");
    } else if (inHelpMenu) {
        resizeImage("title-screen/howtoplay.png");
    }
    gl.canvas.width = window.innerWidth;
    gl.canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    updateProjectionMatrix();
}

/**
 * Updates the projection matrix.
 */
function updateProjectionMatrix() {
    let [w, h] = [gl.canvas.width, gl.canvas.height];
    let p = mat4.perspective(mat4.create(), deg2rad(90), w/h, 0.01, 20);
    gl.uniformMatrix4fv(gl.program.uProjectionMatrix, false, p);
}


/**
 * Updates the model view matrix.
 */
function updateModelViewMatrix(matrix) {
    gl.uniformMatrix4fv(gl.program.uModelViewMatrix, false, matrix);
}


/**
 * Set values for collision
 */
function crash() {
    hasCrashed = true;
    controls[backward].pressed = true;
    controls[backward].value = maxReverse;
    window.removeEventListener('keydown', onKeyDown); 
}


/**
 * Updates the position of the car. Checks for collision with gaurdrail.
 * Moves and rotates appropriately.
 */
function updatePosition() {
    let directionVector = [0, 0, 0];

    // Check game state - reached checkpoint or reached finish line
    if (!hasReachedCheckpoint) checkReachedCheckpoint();
    else checkReachedFinish();

    accelerate();
    if (!isPaused) { // only update car if game is not paused
        if (!hasCrashed) {
            // Go over all keys and update directionVector or rotation depending on key and its value
            Object.keys(controls).forEach(key => { 
                let value = controls[key].value;
                if (key === forward || key === backward) {
                    directionVector[2] += value; 
                }
                if (key === right && controls[key].pressed) {
                    rotation[1] += value;
                } else if (key === left && controls[key].pressed) {
                    rotation[1] += value;
                }
            });
        } else { // if car has crashed
            let value = controls[backward].value;
            if (controls[backward].value === 0) { // done moving backwards from collision
                hasCrashed = false;
                controls[backward].pressed = false;
                window.addEventListener('keydown', onKeyDown); 
            } else { directionVector[2] += value; }
        }
    }
    
    
    // Rotate direction vector
    vec3.rotateX(directionVector, directionVector, [0,0,0], -deg2rad(rotation[0]));
    vec3.rotateY(directionVector, directionVector, [0,0,0], -deg2rad(rotation[1]));
    vec3.rotateZ(directionVector, directionVector, [0,0,0], -deg2rad(rotation[2]));

    // Adds direction vector to current car position after checking for collision
    let vector = stayOnTrack(directionVector);
    vec3.add(trackPosition, trackPosition, vector);
    
    // Rotate point of view    
    let position = mat4.fromXRotation(mat4.create(), deg2rad(rotation[0]));
    mat4.rotateZ(position, position, deg2rad(rotation[2]));
    mat4.rotateY(position, position, deg2rad(rotation[1]));

    // Translate car to correct position
    positionMatrix = mat4.translate(mat4.create(), position, trackPosition);
    mat4.rotateY(positionMatrix, positionMatrix, deg2rad(85)); 

    updateProjectionMatrix();
}

/**
 * draws model with correct texture
 */
function drawModel(matrix, modelNum) {
    gl.uniform1i(gl.program.uTexture, modelNum);
    updateModelViewMatrix(matrix);
    gl.activeTexture(gl['TEXTURE'+modelNum]);
    gl.bindTexture(gl.TEXTURE_2D, gl.models[modelNum+2]);
    gl.bindVertexArray(gl.models[modelNum][0]);
    gl.drawArrays(gl.TRIANGLES, 0, gl.models[modelNum][1]);
    gl.bindTexture(gl.TEXTURE_2D, null);
}


/**
 * Render the scene. Calls drawModel() twice to render 
 * the track and the car.  
 */
function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    updatePosition();
    if (gameStartTime !== 0) updateTimer();
    
    drawModel(positionMatrix, 0); // draw track
    let s = mat4.fromTranslation(mat4.create(), carPosition);
    mat4.scale(s, s, [mustangScale, mustangScale, mustangScale]); // .04
    drawModel(s, 1); // draw car

    // Cleanup
    gl.bindVertexArray(null);
    window.requestAnimationFrame(render);
}

/**
 * Get current rotation of the car.
 * Returns whether or not the car is facing backwards or forwards relative to initial position
 */
function getDirection() {
    let dirForward = false;
    for (let i = 0; i < 10; i+=3) {
        if (rotation[1] > 90*i && rotation[1] < 90*(i+1)) dirForward = true;
    }
    return dirForward;
}


/**
 * Detects if the car will hit the siderails. If there is a collision, 
 * the direction vector's magnitude is lessened to a point right 
 * before the collision point. Returns the direction vector.
 */
function stayOnTrack(directionVector) {

    // Get a point on the curve after transforming it and it's index in the global curve vertices array
    function getCurvePoint(start_index) {
        let curve_point = track.curve_verts.subarray(start_index, start_index+3);

        let rotatedCurvePoint = vec3.rotateX(vec3.create(), curve_point, [0,0,0], deg2rad(rotation[0]));
        vec3.rotateY(rotatedCurvePoint, curve_point, [0,0,0], deg2rad(rotation[1]));
        vec3.rotateZ(rotatedCurvePoint, curve_point, [0,0,0], deg2rad(rotation[2]));

        vec3.rotateY(rotatedCurvePoint, rotatedCurvePoint, [0,0,0], deg2rad(85));
        vec3.add(rotatedCurvePoint, rotatedCurvePoint, [trackPosition[0], trackPosition[1], trackPosition[2]+carPosition[2]]);
        
        return [rotatedCurvePoint, start_index];
    }

    // Get the distances between the current car position and the next track point and previous track point
    function determinePointByDistance(beforePoint, afterPoint) {
        let pointBeforeDistance = vec3.distance(vec3.create(), carPosition, beforePoint);
        let pointAfterDistance = vec3.distance(vec3.create(), carPosition, afterPoint);

        return pointAfterDistance < pointBeforeDistance ? afterPoint : beforePoint; 
    }

    // Get rotation angle for the X-axis. Necessary for when moving up or down hills
    function getRotationAngleAndTranslate(vertex, beforePoint, afterPoint) {
        let point = determinePointByDistance(beforePoint, afterPoint);
        directionVector[1] += (carPosition[1] - point[1]); // Change the elevation of the car
        let angle = vec3.angle(
            vec3.subtract(vec3.create(), [point[0], point[1]+0.1, point[2]], point),
            vec3.subtract(vec3.create(), vertex, point)
        ); // Get the x-axis rotation angle
        return angle;
    }

    // Get the closest predefined point on the curve by looping over all curve vertices
    function getClosestPointOnCurve() {
        // Get an inital starting point
        let [curve_point, i] = getCurvePoint(0);
        let distance = vec3.distance(carPosition, curve_point);
        let shortestDistance = {vertex: curve_point, distance: distance, index: i};

        // Iterate over all vertics to get the closest one
        for (let j = 3; i < track.curve_verts.length; j+=3) {
            [curve_point, i] = getCurvePoint(j);
            distance = vec3.distance(carPosition, curve_point);
            if (distance < shortestDistance.distance) {
                shortestDistance.index = i;
                shortestDistance.vertex = curve_point;
                shortestDistance.distance = distance;
            }
        }
        return shortestDistance;
    }
    
    let shortestDistance = getClosestPointOnCurve();  // Closest predefined point on curve

    // Get the next and previous vertices from the closest vertex
    let [vertex, j] = getCurvePoint(shortestDistance.index+3);
    let [beforeVertex, k] = getCurvePoint(shortestDistance.index-3);

    // Closest points on the track before and after the closest vertex computed by intersection of vector and orthogonal plane from car to curve
    let pointAfter = getClosestCurvePointOnTrack(vertex, shortestDistance.vertex, carPosition);
    let pointBefore = getClosestCurvePointOnTrack(beforeVertex, shortestDistance.vertex, carPosition);

    if (j >= track.curve_verts.length) {  // next vertex doesn't exist in vertices array because we are at the end of the array
        [vertex, j] = getCurvePoint(0);
        pointAfter = getClosestCurvePointOnTrack(vertex, shortestDistance.vertex, carPosition);
    } else if (k < 0) {  // Previous vertex doesn't exist in vertices array because we are at the beginning of the array
        [vertex, j] = getCurvePoint(track.curve_verts.length - 3);
        pointBefore = getClosestCurvePointOnTrack(vertex, shortestDistance.vertex, carPosition);
    }

    // Angle to rotate the x-axis by when the car has elevation changes
    let angle = getRotationAngleAndTranslate(vertex, pointBefore, pointAfter); 
    rotation[0] = -(90 - rad2deg(angle));
    let point = determinePointByDistance(pointBefore, pointAfter);

    // Rotate closest point into correct coordinates
    vec3.rotateX(point, point, [0,0,0], -deg2rad(rotation[0] - previousXRotation));
    vec3.rotateY(point, point, [0,0,0], -deg2rad(rotation[1] - previousYRotation));
    
    // Get distances between closest point and the car's corners and determine if there is a collision
    let topLeftDist = vec3.distance([carBox.minX, carPosition[1], carBox.minZ], point);
    let topRightDist = vec3.distance([carBox.maxX, carPosition[1], carBox.minZ], point);
    collide(point, directionVector, topLeftDist, topRightDist);
    
    return directionVector;
}

/**
 * Depending the car's orientation in the world, correct its position if there is a collision
 */
function collide(point, directionVector, topLeft, topRight) {
    let dirForward = getDirection();
    if (dirForward) {
        if (point[0] > 0) {
            if (topLeft > 0.2)  {
                crash(); 
                directionVector[0] -= 0.05;
            }
        } else {
            if (topRight > 0.1)  {
                crash(); 
                directionVector[0] += 0.05;
            }
        }
    } else {
        if (point[0] > 0) {
            if (topRight > 0.1)  {
                crash(); 
                directionVector[0] -= 0.05;
            }
        } else {
            if (topLeft > 0.2)  {
                crash(); 
                directionVector[0] += 0.50;
            }
        }
    }
    // Update previouse rotations to current rotations
    previousXRotation = rotation[0];
    previousYRotation = rotation[1];
}
