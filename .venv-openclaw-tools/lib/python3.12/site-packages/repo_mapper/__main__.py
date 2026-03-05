import argparse

from .utils import create_repo_map


def main():
    parser = argparse.ArgumentParser(
        description="Generate a repository map and update a README file."
    )
    parser.add_argument(
        "directory",
        type=str,
        help="The root directory to scan for files.",
    )
    parser.add_argument(
        "readme_path",
        type=str,
        help="The path to the README file to update.",
    )
    parser.add_argument(
        "--use-gitignore",
        action="store_true",
        help="Respect .gitignore rules when generating the repo map.",
    )
    parser.add_argument(
        "--allowed-extensions",
        type=str,
        nargs="*",
        default=[],
        help="A list of allowed file extensions to include in the repo map (e.g., '.py', '.yaml'). Defaults to all files.",
    )
    parser.add_argument(
        "--ignore-dirs",
        type=str,
        nargs="*",
        default=[],
        help="A list of directory names to ignore when generating the repo map.",
    )

    args = parser.parse_args()

    create_repo_map(
        directory=args.directory,
        readme_path=args.readme_path,
        allowed_extensions=args.allowed_extensions,
        ignore_dirs=args.ignore_dirs,
        use_gitignore=args.use_gitignore,
    )


if __name__ == "__main__":
    main()
