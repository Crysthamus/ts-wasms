import json
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

GIT_URL_PATTERN = re.compile(
    r"^git\+https://github.com/([^/]+)/([^/#]+?)(?:\.git)?(?:#(.*))?$"
)


def get_json_from_url(url):
    req = urllib.request.Request(url)

    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        print(f"Error fetching {url}: {e.code}")
        return None


def get_latest_commit(owner, repo, sha=None):
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    if sha:
        url += f"?sha={sha}"

    data = get_json_from_url(url)
    if data and isinstance(data, list) and len(data) > 0:
        return data[0]
    return None


def is_hex_hash(s):
    if not s:
        return False
    return bool(re.fullmatch(r"[0-9a-fA-F]{7,40}", s))


def main():
    package_file = "package.json"

    try:
        with open(package_file, "r") as f:
            pkg_data = json.load(f)
    except FileNotFoundError:
        print(f"Could not find {package_file} in the current directory.")
        return

    dev_deps = pkg_data.get("devDependencies", {})
    modified = False

    for pkg, version in dev_deps.items():
        match = GIT_URL_PATTERN.match(version)
        if not match:
            continue

        owner, repo, fragment = match.groups()
        base_url = f"https://github.com/{owner}/{repo}"

        if fragment == "release":
            commit_data = get_latest_commit(owner, repo, sha="release")
            if commit_data:
                date_str = commit_data["commit"]["author"]["date"]
                commit_date = datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%SZ").replace(
                    tzinfo=timezone.utc
                )

                if datetime.now(timezone.utc) - commit_date > timedelta(days=365):
                    print(
                        f"[{pkg}] {base_url} (Has '#release' but hasn't been updated in over 1 year)"
                    )
            continue

        if is_hex_hash(fragment):
            latest_commit_data = get_latest_commit(owner, repo)
            if latest_commit_data:
                latest_sha = latest_commit_data["sha"]

                if not latest_sha.startswith(fragment.lower()):
                    print(
                        f"[{pkg}] {base_url} (Newer commit available! Current: {fragment}, Latest: {latest_sha[:7]})"
                    )

        else:
            latest_commit_data = get_latest_commit(owner, repo)
            if latest_commit_data:
                latest_sha = latest_commit_data["sha"]

                new_version = f"git+https://github.com/{owner}/{repo}.git#{latest_sha}"
                dev_deps[pkg] = new_version
                modified = True
                print(f"[{pkg}] Appended missing hash: {latest_sha[:7]}")

    if modified:
        with open(package_file, "w") as f:
            json.dump(pkg_data, f, indent=4)
        print("\nSuccessfully saved newly appended hashes to package.json")
    else:
        print("\nFinished checking. No new hashes needed appending.")


if __name__ == "__main__":
    main()
