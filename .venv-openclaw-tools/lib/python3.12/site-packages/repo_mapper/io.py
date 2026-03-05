def read_file(path: str) -> str:
    with open(path, "r") as f:
        text = f.read()
    return text


def write_file(path: str, text: str) -> bool:
    try:
        with open(path, "w") as f:
            f.write(text)
        return True
    except Exception as e:
        print({"path": path, "text": text, "error": e})
        return False
