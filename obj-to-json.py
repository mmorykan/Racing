#!/usr/bin/env python3

import argparse
import json

def obj_to_dict(obj_file):
    vertices = []
    indices = []
    texture = []
    texture_indices = []
    normals = []
    normal_indices = []
    lines = []
    curve_verts = []
    curve_lines = []    
    file_lines = obj_file.readlines()
    for line in file_lines:
        data = line.strip().split('#', 1)[0].split()
        if not data:
            continue
        if data[0] == 'v':
            if len(data) != 4:
                raise ValueError('All vertices must be 3D, at least one vertex is {}D'.format(len(data)-1))
            vertices.extend(float(v) for v in data[1:])
        elif data[0] == 'f':
            if len(data) != 4:
                raise ValueError('All faces must be triangles, at least one face has {} vertices'.format(len(data)-1))
            for vertex in data[1:]:
                slash = vertex.find('/')
                if slash != -1: vertex = vertex[:slash]
                indices.append(int(vertex)-1)
                texture_indices.append(int(vertex)+1)
                normal_indices.append(int(vertex)+3)
        # Mark edited this bit
        elif data[0].startswith('vt'):
            if len(data) != 3:
                raise ValueError('All texture vertices must be 2D, at least one vertex is {}D'.format(len(data)-1))
            texture.extend(float(v) for v in data[1:])
        elif data[0].startswith('vn'):
            normals.extend(float(v) for v in data[1:])
        elif data[0] == 'l':
            if len(data) != 3:
                raise ValueError('Bad lines')
            lines.extend(int(index) for index in data[1:])
        elif data[0] == 'o' and 'curve' in data[1].lower():
            index = file_lines.index(line) + 1
            for i in range(index, len(file_lines)):
                data = file_lines[i].strip().split('#', 1)[0].split()
                if not data:
                    continue
                if data[0] == 'v':
                    if len(data) != 4:
                        raise ValueError('All vertices must be 3D, at least one vertex is {}D'.format(len(data)-1))
                    curve_verts.extend(float(v) for v in data[1:])
                elif data[0] == 'l':
                    if len(data) != 3:
                        raise ValueError('Bad lines')
                    curve_lines.extend(int(i) for i in data[1:])
                else:
                    break
        # Mark stopped editing here and the return stmt

    return {"vertices": vertices, "indices": indices, "texture": texture, "texture_inds": texture_indices, "lines": lines, 
        "curve_verts": curve_verts, "curve_lines": curve_lines, "normals": normals, "normal_indices": normal_indices}

def main():
    parser = argparse.ArgumentParser(description='Convert 3D model from OBJ to JSON\nVery simple! No support for texture coordinates, normals, materials, and any other OBJ things')
    parser.add_argument('obj', type=argparse.FileType('r'), help='OBJ file to read')
    parser.add_argument('json', type=argparse.FileType('w'), help='JSON file to write to')
    args = parser.parse_args()
    json.dump(obj_to_dict(args.obj), args.json)

if __name__ == "__main__":
    main()
