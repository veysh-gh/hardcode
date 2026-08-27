import path from "node:path";

export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function resolveRelativePath(root, requestedPath = "", errorMessage = "Path escapes its root.") {
  if (typeof requestedPath !== "string" || path.isAbsolute(requestedPath)) {
    throw new Error(errorMessage);
  }

  const target = path.resolve(root, requestedPath || ".");
  if (!isPathInside(root, target)) throw new Error(errorMessage);
  return target;
}
