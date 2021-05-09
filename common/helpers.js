/* exported vec3, vec4, mat4, quat, deg2rad, rad2deg, getClosestCurvePointOnTrack */

// Allow use of glMatrix values directly instead of needing the glMatrix prefix
const vec3 = glMatrix.vec3;
const vec4 = glMatrix.vec4;
const mat4 = glMatrix.mat4;
const quat = glMatrix.quat;

/**
 * Converts degrees to radians.
 */
function deg2rad(degrees) {
    return degrees * Math.PI / 180;
}

/** 
 * Converts radians to degrees
 */
function rad2deg(radians) {
    return radians * 180 / Math.PI;
}

/**
 * Determines the point on the curve immediately beneathe the car.
 */
function getClosestCurvePointOnTrack(vertexOnTrack, closestVertex, carPosition) {
    // Get the vectors starting at closest vertex and ending at next and previous vertices
    let V = vec3.subtract(vec3.create(), vertexOnTrack, closestVertex);

    // Calculates the point on the track directly beneathe the car's position using the next vertex
    let t = (-V[0]*closestVertex[0] + V[0]*carPosition[0]
             -V[1]*closestVertex[1] + V[1]*carPosition[1]
             -V[2]*closestVertex[2] + V[2]*carPosition[2])
             /(Math.pow(V[0], 2) + Math.pow(V[1], 2) + Math.pow(V[2], 2));

    let point = vec3.scaleAndAdd(vec3.create(), closestVertex, V, t);
    
    return point;
}
