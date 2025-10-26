const SCALE_FACTOR = 1.5; // Optimized for performance

const vertexShaderSource = `
attribute vec2 a_position;
void main(){
   gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentShaderSource = `
// @murillobrand: Shader, animation recreation
// @seanaiux: Original animation (https://www.instagram.com/p/DNRGAV3Ahc7)

precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_logo;

#define MAX_STEPS 64
#define MAX_DIST  100.0
#define SURF_EPS  0.001

struct Hit { float d; int mat; };


/* ======= UTILITIES ======= */
mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1,0,0, 0,c,-s, 0,s,c); }
mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0,s,  0,1,0,  -s,0,c); }
mat3 rotZ(float a){ float c=cos(a), s=sin(a); return mat3(c,-s,0, s,c,0,  0,0,1); }
mat3 eulerXYZ(vec3 a){ return rotZ(a.z) * rotY(a.y) * rotX(a.x); }


/* ======= SDF Primitives ======= */
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdTorusRoundedRect(vec3 p, float R, vec2 halfWH, float bevel) {
    // halfWH = metade da largura/altura da seção
    // bevel = raio do arredondamento dos cantos da seção
    vec2 k = vec2(length(p.xz) - R, p.y);
    vec2 q = abs(k) - (halfWH - vec2(bevel));
    float outside = length(max(q, 0.0)) - bevel;
    float inside  = min(max(q.x, q.y), 0.0) - bevel;
    return outside + inside;
}


/* ======= SCENE ======= */
Hit map(vec3 p){    
    /* ===== RINGS & SPHERE ===== */
    // Momentum-based startup: rings start flat and gradually build up rotation
    // Cold start simulation - requires momentum to get going
    
    // Momentum buildup function - all rings start together, slowly accelerate together
    float globalMomentum = smoothstep(0.0, 8.0, u_time) * smoothstep(0.0, 1.0, u_time - 1.0); // All start after 1s, reach full speed over 8s
    
    // Apply momentum with easing - starts very slow, then accelerates
    float easedMomentum = globalMomentum * globalMomentum * (3.0 - 2.0 * globalMomentum); // Smooth acceleration curve
    
    // Use wrapped time to prevent unbounded rotation values (loops smoothly every ~314 seconds)
    // Using TWO_PI (6.28318) ensures rotations are properly wrapped at natural cycle boundaries
    const float TWO_PI = 6.283185307179586;
    float wrappedTime = mod(u_time * 0.5, TWO_PI * 100.0); // Loop every 628 seconds (~10.5 minutes)
    
    // Rotation calculations with momentum-based speed - all rings use same momentum
    // Wrapping prevents numerical drift while maintaining continuous rotation appearance
    vec3 rot1 = vec3(
        easedMomentum * wrappedTime * 1.8, 
        easedMomentum * wrappedTime * 1.8, 
        easedMomentum * wrappedTime * 1.8
    );
    
    vec3 rot2 = vec3(
        easedMomentum * wrappedTime/2.0 * 1.6, 
        easedMomentum * wrappedTime/1.2 * 1.6, 
        easedMomentum * wrappedTime/1.5 * 1.6
    );
    
    vec3 rot3 = vec3(
        easedMomentum * -wrappedTime*1.2 * 1.7, 
        easedMomentum * -wrappedTime * 1.7, 
        easedMomentum * -wrappedTime * 1.7
    );
    
    vec3 q1 = p * eulerXYZ(rot1);
    vec3 q2 = p * eulerXYZ(rot2);
    vec3 q3 = p * eulerXYZ(rot3);
    float dRing = sdTorusRoundedRect(q1, 1.5, vec2(0.05, 0.14), 0.007);
    float dRing2 = sdTorusRoundedRect(q2, 1.2, vec2(0.05, 0.14), 0.007);
    float dRing3 = sdTorusRoundedRect(q3, 0.9, vec2(0.05, 0.14), 0.007);
    float dSphere = sdSphere(p, 0.32);
    
    /* ===== Scene combination ===== */
    float d = dSphere;
    int mat = 0; // Start with sphere
    
    if(dRing < d) { d = dRing; mat = 1; }
    if(dRing2 < d) { d = dRing2; mat = 2; }
    if(dRing3 < d) { d = dRing3; mat = 3; }
    
    return Hit(d, mat);
}


/* ======= RAYMARCHING ======= */
Hit raymarch(vec3 ro, vec3 rd){
    float t = 0.0;
    int m = -1;
    for(int i=0;i<MAX_STEPS;i++){
        vec3 p = ro + rd*t;
        Hit h = map(p);
        if(h.d < SURF_EPS) { m = h.mat; break; }
        t += h.d;
        if(t > MAX_DIST) break;
    }
    return Hit(t, m);
}


/* ======= RENDERING ======= */
vec3 calcNormal(vec3 p){
    const vec2 e = vec2(1.0, -1.0)*0.5773;
    const float eps = 0.0008;
    return normalize( e.xyy*map(p + e.xyy*eps).d +
                      e.yyx*map(p + e.yyx*eps).d +
                      e.yxy*map(p + e.yxy*eps).d +
                      e.xxx*map(p + e.xxx*eps).d );
}

float blinnPhongSpec(vec3 n, vec3 v, vec3 l, float shininess){
    vec3 h = normalize(v + l);
    return pow(max(dot(n, h), 0.0), shininess);
}

// Ambient occlusion removed for performance
float ambientOcclusion(vec3 p, vec3 n){
    return 1.0; // Simplified - no AO calculations
}

mat3 lookAt(vec3 ro, vec3 ta, float roll){
    vec3 f = normalize(ta - ro);
    vec3 r = normalize(cross(vec3(0.0,1.0,0.0), f));
    r = r*cos(roll) + cross(f,r)*sin(roll);
    vec3 u = cross(f, r);
    return mat3(r, u, f);
}

void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5*u_resolution.xy) / u_resolution.y;

    // Camera - Even further back for smaller animation
    float radius = 3.2;
    vec3 ro = vec3(radius*1.1, radius*0.8, radius*1.1);
    vec3 ta = vec3(0.0, 0.0, 0.0);
    mat3 cam = lookAt(ro, ta, 0.0);
    vec3 rd = normalize(cam * normalize(vec3(uv, 1.4)));

    // Raymarching
    Hit h = raymarch(ro, rd);

    // Start with transparent background
    vec4 col = vec4(0.0, 0.0, 0.0, 0.0);
    
    if(h.mat >= 0){
        vec3 p = ro + rd*h.d;
        vec3 n = calcNormal(p);
        vec3 v = normalize(ro - p);

        // Params - Different shininess for sphere vs rings
        float shininess = (h.mat == 0) ? mix(4.0, 16.0, 0.2) : 64.0; // Rings more metallic
        vec3  F0 = vec3(0.4);

        // Central sphere as primary light source
        vec3 spherePos = vec3(0.0, 0.0, 0.0);
        vec3 lightDir = normalize(spherePos - p);
        float lightDist = length(spherePos - p);
        
        // Subtle sphere illumination with gentle pulsing
        float pulseIntensity = sin(u_time * 3.0) * 0.25 + 0.6;
        float lightIntensity = 1.0;
        if(h.mat >= 1) { // All rings - Moderate lighting for visibility
            // Calculate distance-based illumination from sphere
            float distToSphere = length(p);
            float sphereLight = 1.0 / (1.0 + distToSphere * 2.0);
            
            // Detect if surface is facing away from center (outer surface)
            float facingAway = max(dot(n, -lightDir), 0.0);
            
            // Give rings enough lighting to be visible
            lightIntensity = sphereLight * 1.2 + 0.5;
        } else { // Sphere (inside) - Subtle bright
            lightIntensity = 3.8 + pulseIntensity * 1.0;
        }
        
        float diff;
        if(h.mat >= 1) { // All rings - diffuse based on facing away from center
            diff = max(dot(n, -lightDir), 0.0) * lightIntensity;
        } else { // Sphere - normal diffuse
            diff = max(dot(n, lightDir), 0.0) * lightIntensity;
        }
        float sh = 1.0;

        // Updated ring colors: Light soft purple, teal, and soft blue
        vec3 base;
        if(h.mat == 0) { // Sphere (inside) - Logo purple with white highlight effect
            base = vec3(138.0/255.0, 43.0/255.0, 226.0/255.0); // Logo purple (#8A2BE2 - BlueViolet)
            // Add white highlight effect like in logo
            float highlight = sin(u_time * 2.0) * 0.3 + 0.7;
            base = mix(base, vec3(1.0), highlight * 0.4); // White highlight overlay
            // Add natural pulsing glow effect
            float glow = 1.0 + sin(u_time * 1.5) * 0.2 + sin(u_time * 0.8) * 0.1;
            base *= glow;
            
            // Add logo texture to sphere
            vec2 sphereUV = vec2(
                atan(p.x, p.z) / (2.0 * 3.14159) + 0.5,
                acos(p.y / length(p)) / 3.14159
            );
            vec4 logoColor = texture2D(u_logo, sphereUV);
            base = mix(base, logoColor.rgb, logoColor.a * 0.8);
        } else if(h.mat == 1) { // Ring 1 - Light soft purple (outermost)
            base = vec3(186.0/255.0, 147.0/255.0, 216.0/255.0); // Light soft purple (#BA93D8)
        } else if(h.mat == 2) { // Ring 2 - Teal (middle)
            base = vec3(72.0/255.0, 209.0/255.0, 204.0/255.0); // Teal (#48D1CC)
        } else if(h.mat == 3) { // Ring 3 - Soft blue (innermost)
            base = vec3(135.0/255.0, 206.0/255.0, 235.0/255.0); // Soft blue (#87CEEB - SkyBlue)
        }
        
        // Ambient occlusion
        float ao = ambientOcclusion(p, n);
        if( h.mat >= 1 ) ao = ao*0.1;

        vec3 amb;
        if(h.mat >= 1) { // All rings
            amb = base * 0.25; // Reduced ambient for higher contrast
        } else { // Sphere
            amb = base * (0.2 + 0.8 * ao);
        }

        // Specular lighting for both sphere and rings
        vec3 dl = vec3(0.0);
        float specBP = blinnPhongSpec(n, v, lightDir, shininess);
        
        if(h.mat == 0) { // Sphere - purely emissive, no shadows
            // Use the sphere's natural purple color without high light intensity
            dl = base;
        } else { // All rings - metallic specular
            vec3 metallicSpec = mix(vec3(0.8), base, 0.2); // Bright metallic highlights
            dl = (base * diff + metallicSpec * specBP * lightIntensity * 1.5) * sh;
        }

        col = vec4(amb + dl, 1.0);
    }
    
    // Enhanced sphere illumination effect to background
    float distToCenter = length(uv);
    
    // Natural central sphere glow
    float pulsePhase = sin(u_time * 1.2) * 0.2 + sin(u_time * 0.6) * 0.1 + 0.7;
    float sphereGlow = (0.8 + pulsePhase * 0.3) / (1.0 + distToCenter * 4.0);
    
    // Blue illumination from sphere
    vec3 illuminationColor = vec3(25.0/255.0, 25.0/255.0, 112.0/255.0) * 2.0;  // Blue light
    
    // Subtle illumination with sphere glow only
    col.rgb += illuminationColor * sphereGlow * 0.8;
    
    // Add gentle atmospheric glow effect
    float atmosphericGlow = 1.0 / (1.0 + distToCenter * 3.0);
    col.rgb += illuminationColor * atmosphericGlow * 0.6 * pulsePhase;
    
    // Add subtle color shifting animation
    float colorShift = sin(u_time * 1.8) * 0.1 + 0.9;
    col.rgb *= colorShift;
    
    gl_FragColor = col;
}`;

document.addEventListener('DOMContentLoaded', function() {
    
    const canvas = document.getElementById('webgl-canvas');
    console.log('Canvas found:', canvas);
    
    // Performance monitoring
    let fps = 0;
    let frameCount = 0;
    let lastTime = performance.now();
    let qualityLevel = 1.0; // Dynamic quality adjustment
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const gl = canvas.getContext('webgl');
    
    if (!gl) {
        console.error('WebGL not supported, trying webgl2');
        const gl2 = canvas.getContext('webgl2');
        if (!gl2) {
            console.error('WebGL2 also not supported');
            // Create a simple fallback
            canvas.style.background = 'radial-gradient(circle, #A65FF3 0%, #6A0DAD 50%, #0D2233 100%)';
            return;
        }
        gl = gl2;
    }
    
    console.log('WebGL context created successfully');

    const onResize = () => {
        canvas.width = window.innerWidth * SCALE_FACTOR;
        canvas.height = window.innerHeight * SCALE_FACTOR;
        canvas.style.width = window.innerWidth + "px";
        canvas.style.height = window.innerHeight + "px";
        gl.viewport(0, 0, window.innerWidth * SCALE_FACTOR, window.innerHeight * SCALE_FACTOR);
    }
    window.addEventListener("resize", onResize);
    onResize();

    const compileShader = (shaderSource, shaderType) => {
        const shader = gl.createShader(shaderType);
        gl.shaderSource(shader, shaderSource);
        gl.compileShader(shader);
        const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (!success) {
            console.error("Failed to compile shader:", gl.getShaderInfoLog(shader));
            console.error("Shader source:", shaderSource);
            gl.deleteShader(shader);
            return null;
        }
        console.log("Shader compiled successfully");
        return shader;
    }
    const createProgram = (vertexSource, fragmentSource) => {
        const vertexShader = compileShader(vertexSource, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(fragmentSource, gl.FRAGMENT_SHADER);
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.useProgram(program);
        return program;
    }

    const program = createProgram(vertexShaderSource, fragmentShaderSource);
    const program_a_position = gl.getAttribLocation(program, 'a_position');
    const program_u_resolution = gl.getUniformLocation(program, 'u_resolution');
    const program_u_time = gl.getUniformLocation(program, 'u_time');

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0, -1.0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(program_a_position);
    gl.vertexAttribPointer(program_a_position, 2, gl.FLOAT, 0, 8, 0);

    const render = (time) => {
        // FPS calculation
        frameCount++;
        const currentTime = performance.now();
        if (currentTime - lastTime >= 1000) {
            fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
            frameCount = 0;
            lastTime = currentTime;
            
            // Dynamic quality adjustment based on FPS
            if (fps < 30 && qualityLevel > 0.5) {
                qualityLevel = Math.max(0.5, qualityLevel - 0.1);
                console.log(`Low FPS (${fps}), reducing quality to ${qualityLevel}`);
            } else if (fps > 50 && qualityLevel < 1.0) {
                qualityLevel = Math.min(1.0, qualityLevel + 0.05);
            }
        }
        
        // Apply quality scaling to resolution
        const scaledWidth = window.innerWidth * SCALE_FACTOR * qualityLevel;
        const scaledHeight = window.innerHeight * SCALE_FACTOR * qualityLevel;
        
        gl.uniform2f(program_u_resolution, scaledWidth, scaledHeight);
        gl.uniform1f(program_u_time, time * 0.001);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
});

// State Tracking Constants
const STATES = {
    HERO: 'hero',
    PREVIEW: 'preview',
    TEAM_CARD: 'team-card',
    PROJECTS_PREVIEW: 'projects-preview',
    PROJECTS: 'projects',
    TEAM: 'team',
    FINAL: 'final'
};

// Frosted Box Wheel Detection with State Tracking
document.addEventListener('DOMContentLoaded', function() {
    const frostedBox = document.getElementById('frosted-box');
    const projectsBox = document.getElementById('projects-box');
    const teamBox = document.getElementById('team-box');
    let isBoxVisible = false; // Start with card hidden
    let wheelTimeout;
    let currentState = STATES.PREVIEW; // Track current state - start in preview
    let isTransitioning = false; // Prevent rapid state changes
    
    // Initialize team card in preview state (showing 40% at bottom)
    frostedBox.classList.add('preview');
    // Initialize projects card hidden
    projectsBox.style.display = 'none';
    // Initialize team card hidden
    teamBox.style.display = 'none';
    
    // State change callback function
    function onStateChange(newState, previousState) {
        console.log(`State changed: ${previousState} → ${newState}`);
        
        // Update body class for CSS targeting
        document.body.className = document.body.className.replace(/state-\w+/g, '');
        document.body.classList.add(`state-${newState}`);
        
        // Dispatch custom event for other components to listen to
        const stateChangeEvent = new CustomEvent('stateChange', {
            detail: {
                current: newState,
                previous: previousState,
                timestamp: Date.now()
            }
        });
        window.dispatchEvent(stateChangeEvent);
    }
    
    // Throttle wheel events for better performance
    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }
    
    // Handle wheel detection
    function handleWheel(event) {
        // Prevent default scroll behavior
        event.preventDefault();
        
        // Prevent rapid state changes during transitions
        if (isTransitioning) {
            return;
        }
        
        const deltaY = event.deltaY;
        
        // Only trigger if there's a meaningful wheel movement
        if (Math.abs(deltaY) > 10) {
            const previousState = currentState;
            
            // Set transition flag to prevent rapid changes
            isTransitioning = true;
            
            if (deltaY > 0 && currentState === STATES.PREVIEW) {
                // Scrolling down from preview - show full team card with projects preview
                console.log('Showing full team card with projects preview');
                frostedBox.classList.remove('preview');
                frostedBox.classList.add('show');
                // Show projects card in preview state
                projectsBox.style.display = 'flex';
                projectsBox.classList.add('projects-preview');
                document.body.classList.add('card-shown');
                isBoxVisible = true;
                currentState = STATES.TEAM_CARD;
                onStateChange(currentState, previousState);
                
            } else if (deltaY > 0 && currentState === STATES.TEAM_CARD) {
                // Scrolling down from team card - show full projects card
                console.log('Showing full projects card');
                
                // Team card slides up and out
                frostedBox.classList.add('slide-up');
                
                // Projects card slides up to full view
                projectsBox.classList.remove('projects-preview');
                projectsBox.classList.add('projects');
                
                // Show team card preview at bottom
                teamBox.style.display = 'flex';
                teamBox.classList.add('team-preview');
                
                currentState = STATES.PROJECTS;
                onStateChange(currentState, previousState);
                
            } else if (deltaY < 0 && currentState === STATES.TEAM_CARD) {
                // Scrolling up from team card - go back to preview
                frostedBox.classList.remove('show');
                frostedBox.classList.add('preview');
                // Hide projects card preview
                projectsBox.style.display = 'none';
                projectsBox.classList.remove('projects-preview');
                document.body.classList.remove('card-shown');
                isBoxVisible = false;
                currentState = STATES.PREVIEW;
                onStateChange(currentState, previousState);
                
            } else if (deltaY > 0 && currentState === STATES.PROJECTS) {
                // Scrolling down from projects - show team card
                console.log('Showing team card');
                
                // Projects card slides up and out
                projectsBox.classList.add('slide-up');
                
                // Team card slides up from preview to full view
                teamBox.classList.remove('team-preview');
                teamBox.classList.add('team');
                
                currentState = STATES.TEAM;
                onStateChange(currentState, previousState);
                
            } else if (deltaY > 0 && currentState === STATES.TEAM) {
                // Scrolling down from team - go to final blank state
                console.log('Going to final state');
                
                // Team card slides up and out of view
                teamBox.classList.remove('team');
                teamBox.classList.add('slide-up');
                
                currentState = STATES.FINAL;
                onStateChange(currentState, previousState);
                
            } else if (deltaY < 0 && currentState === STATES.FINAL) {
                // Scrolling up from final - go back to team
                console.log('Going back to team');
                
                // Team card slides down from above
                teamBox.classList.remove('slide-up');
                teamBox.classList.add('team');
                
                currentState = STATES.TEAM;
                onStateChange(currentState, previousState);
                
            } else if (deltaY < 0 && currentState === STATES.TEAM) {
                // Scrolling up from team - go back to projects
                console.log('Going back to projects');
                
                // Team card slides down to preview state
                teamBox.classList.remove('team');
                teamBox.classList.add('team-preview');
                
                // Projects card slides down from above to replace it
                projectsBox.classList.remove('slide-up');
                projectsBox.classList.add('projects');
                
                currentState = STATES.PROJECTS;
                onStateChange(currentState, previousState);
                
            } else if (deltaY < 0 && currentState === STATES.PROJECTS) {
                // Scrolling up from projects - go back to team card with projects preview
                console.log('Going back to team card with projects preview');
                
                // Projects card slides down to preview
                projectsBox.classList.remove('projects');
                projectsBox.classList.add('projects-preview');
                
                // Hide team card preview
                teamBox.style.display = 'none';
                teamBox.classList.remove('team-preview');
                
                // Team card slides down from above to replace it
                frostedBox.classList.remove('slide-up');
                frostedBox.classList.add('show');
                
                document.body.classList.add('card-shown');
                isBoxVisible = true;
                currentState = STATES.TEAM_CARD;
                onStateChange(currentState, previousState);
            }
            
            // Reset transition flag after animation completes
            setTimeout(() => {
                isTransitioning = false;
            }, 600); // Match CSS transition duration
        }
    }
    
    // Add throttled wheel listener
    window.addEventListener('wheel', throttle(handleWheel, 100), { passive: false }); // Slower throttle for more deliberate scrolling
    
    // Letter-by-letter animation function
    function animateTextLetters() {
        const heroText = document.querySelector('#final-text-box .hero-text p');
        if (!heroText) return;
        
        const text = heroText.textContent;
        heroText.innerHTML = '';
        
        // Split text into words to prevent line breaks within words
        const words = text.split(' ');
        let letterIndex = 0;
        
        words.forEach((word, wordIndex) => {
            // Create a word container to keep letters together
            const wordSpan = document.createElement('span');
            wordSpan.style.display = 'inline-block';
            wordSpan.style.whiteSpace = 'nowrap';
            
            // Add each letter of the word
            for (let i = 0; i < word.length; i++) {
                const letterSpan = document.createElement('span');
                letterSpan.textContent = word[i];
                letterSpan.classList.add('letter-animate');
                letterSpan.style.setProperty('--letter-index', letterIndex);
                wordSpan.appendChild(letterSpan);
                letterIndex++;
            }
            
            heroText.appendChild(wordSpan);
            
            // Add space between words (except after the last word)
            if (wordIndex < words.length - 1) {
                const spaceSpan = document.createElement('span');
                spaceSpan.textContent = ' ';
                spaceSpan.style.whiteSpace = 'pre';
                heroText.appendChild(spaceSpan);
            }
        });
    }
    

    
    // Enhanced state change callback
    const originalOnStateChange = onStateChange;
    onStateChange = function(newState, previousState) {
        originalOnStateChange(newState, previousState);
        
        // Trigger letter animation when reaching final state
        if (newState === STATES.FINAL) {
            setTimeout(() => {
                animateTextLetters();
            }, 100); // Small delay to ensure DOM is ready
        }
    };
    
    // Public API for external access
    window.QVibeState = {
        getCurrentState: () => currentState,
        getStates: () => STATES,
        addStateListener: (callback) => {
            window.addEventListener('stateChange', callback);
        },
        removeStateListener: (callback) => {
            window.removeEventListener('stateChange', callback);
        }
    };
    
    // Initial state setup
    onStateChange(currentState, null);
});

// Dropdown functionality
document.addEventListener('DOMContentLoaded', function() {
    const dropdowns = document.querySelectorAll('.dropdown');
    
    dropdowns.forEach(dropdown => {
        const button = dropdown.querySelector('.nav-button');
        const content = dropdown.querySelector('.dropdown-content');
        
        let isOpen = false;
        let wasClicked = false;
        
        // Toggle dropdown on click
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            wasClicked = true;
            isOpen = !isOpen;
            
            if (isOpen) {
                dropdown.classList.add('active');
            } else {
                dropdown.classList.remove('active');
            }
        });
        
        // Keep dropdown open on hover when clicked
        dropdown.addEventListener('mouseenter', function() {
            if (wasClicked) {
                dropdown.classList.add('active');
            }
        });
        
        dropdown.addEventListener('mouseleave', function() {
            // Only close on hover-leave if it wasn't clicked open
            if (!wasClicked) {
                dropdown.classList.remove('active');
            }
        });
        
        // Prevent clicks inside dropdown from closing it
        content.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('active');
                isOpen = false;
                wasClicked = false;
            }
        });
        
        // Add smooth transitions to the dropdown items
        const links = dropdown.querySelectorAll('.dropdown-link');
        links.forEach((link, index) => {
            link.style.transitionDelay = `${index * 0.05}s`;
        });
    });
});