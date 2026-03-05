import fnmatch
import glob
import os
import re
from collections import defaultdict
from typing import Collection

from . import io


def create_repo_map(
    directory: str,
    readme_path: str,
    allowed_extensions: Collection[str] = None,
    ignore_dirs: Collection[str] = None,
    use_gitignore: bool = True,
) -> bool:
    allowed_extensions = () if allowed_extensions is None else tuple(allowed_extensions)
    ignore_dirs = ignore_dirs or []
    gitignore = get_gitignore(directory) if use_gitignore else []

    files = [
        os.path.relpath(f, start=os.path.dirname(directory))
        for f in glob.glob(
            os.path.join(directory, "**/*"),
            recursive=True,
        )
        if (not allowed_extensions or f.endswith(allowed_extensions))
        and (
            not gitignore
            or not any(fnmatch.fnmatch(f, f"*{pattern}*") for pattern in gitignore)
        )
    ]

    new_tree_map = get_file_tree(files, ignore_dirs)
    return write_to_readme(readme_path, new_tree_map)


def get_gitignore(directory: str) -> list:
    try:
        gitignore = io.read_file(f"{directory}/.gitignore")
        gitignore = [i for i in gitignore.splitlines() if not i.startswith("#") and i]
        gitignore.append(".git/")
        gitignore += [i.strip("*/") for i in gitignore]
        return gitignore
    except (FileExistsError, FileNotFoundError):
        print(f"No gitignore found in directory: {directory}")
        return []


def get_file_tree(files: list[str], ignore_dirs: Collection[str]) -> str:
    tree = render_tree(build_file_tree(files), ignore_dirs)
    return f"# generated repo map\n```\n{tree}\n::\n```"


def write_to_readme(readme_path: str, new_tree_map: str) -> bool:
    text = io.read_file(readme_path)

    old_tree_map = "# generated repo map\n```\n(.*?)\n```"

    if bool(re.search(old_tree_map, text, re.DOTALL)):
        try:
            text = re.sub(old_tree_map, new_tree_map, text, flags=re.DOTALL)
        except re.error as e:
            print(f"Regex substitution failed: {e}")
            return False
    else:
        print(f"Unable to find generated repo map, appending to end of `{readme_path}`")
        text += f"\n{new_tree_map}"

    if not io.write_file(readme_path, text):
        return False

    print(f"Successfully updated tree at `{readme_path}`")
    return True


def build_file_tree(paths: list[str]) -> dict:
    def _convert_to_dict(d: defaultdict) -> dict:
        return {k: _convert_to_dict(v) for k, v in d.items()}

    def _insert_node(tree, parts):
        if parts:
            tree[parts[0]] = _insert_node(
                tree.get(parts[0], defaultdict(dict)), parts[1:]
            )
        return tree

    tree = defaultdict(dict)
    for path in paths:
        parts = path.strip(os.sep).split(os.sep)
        _insert_node(tree, parts)

    return _convert_to_dict(tree)


def render_tree(tree: dict, ignore_dirs: Collection[str]) -> str:
    def _walk(tree: dict, prefix: str = ""):
        items = sorted(
            tree.keys(), key=lambda x: (os.path.splitext(x)[1].startswith("."), x)
        )
        for i, name in enumerate(items):
            if name in ignore_dirs:
                continue
            is_last = i == len(items) - 1
            connector = "└── " if is_last else "├── "
            out_tree.append(f"{prefix}{connector}{name}")

            sub_tree = tree[name]
            if isinstance(sub_tree, dict):
                new_prefix = prefix + ("    " if is_last else "│   ")
                _walk(sub_tree, new_prefix)

    out_tree = []
    _walk(tree)
    return "\n".join(out_tree)
