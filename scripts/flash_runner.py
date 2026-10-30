#!/usr/bin/env python3
"""
Thruster Flashing Runner
Provides a clean, single-line in-place progress bar, formatted memory statistics,
and automated log retention management (.thruster/logs and .thruster/crashes).
"""

import sys
import os
import json
import time
import re
import subprocess
from datetime import datetime

def format_bytes(n):
    if n is None:
        return "N/A"
    return f"{n:,} bytes"

def render_memory_banner(memory):
    if not memory:
        return
    lines = []
    lines.append("\033[1;34m📊 Memory Usage:\033[0m")
    
    flash = memory.get("flash")
    if flash:
        used = format_bytes(flash.get("used"))
        total = format_bytes(flash.get("max"))
        pct = flash.get("percent")
        pct_str = f"({pct}%)" if pct is not None else ""
        free = format_bytes(flash.get("free"))
        free_str = f" [{free} free]" if flash.get("free") is not None else ""
        lines.append(f"   \033[0;36m• Program Storage (Flash):\033[0m {used} / {total} {pct_str}{free_str}")
        
    ram = memory.get("ram")
    if ram:
        used = format_bytes(ram.get("used"))
        total = format_bytes(ram.get("max"))
        pct = ram.get("percent")
        pct_str = f"({pct}%)" if pct is not None else ""
        free = format_bytes(ram.get("free"))
        free_str = f" [{free} free]" if ram.get("free") is not None else ""
        lines.append(f"   \033[0;36m• Dynamic Memory (RAM):   \033[0m {used} / {total} {pct_str}{free_str}")
        
    print("\n".join(lines) + "\n")

def render_progress_bar(pct, elapsed_sec, status=""):
    pct = max(0, min(100, int(pct)))
    width = 32
    filled = int(width * pct / 100)
    if filled > 0:
        bar = "=" * (filled - 1) + (">" if filled < width else "=")
    else:
        bar = ""
    bar = bar.ljust(width, " ")
    
    elapsed_str = f"{elapsed_sec:.1f}s"
    status_str = f" \033[0;90m{status}\033[0m" if status else ""
    line = f"\r\033[K\033[1;36mFlashing\033[0m [\033[1;32m{bar}\033[0m] \033[1;33m{pct:>3}%\033[0m \033[0;90m({elapsed_str})\033[0m{status_str}"
    sys.stdout.write(line)
    sys.stdout.flush()

def ensure_gitignore(ws_dir):
    if not ws_dir:
        return
    git_dir = os.path.join(ws_dir, ".git")
    if not os.path.exists(git_dir):
        return

    gitignore_path = os.path.join(ws_dir, ".gitignore")
    existing = ""
    if os.path.exists(gitignore_path):
        try:
            with open(gitignore_path, "r", encoding="utf-8") as f:
                existing = f.read()
        except Exception:
            existing = ""

    lines = [line.strip() for line in existing.splitlines()]
    if ".thruster" in lines or ".thruster/" in lines:
        return

    entries_to_add = []
    if ".thruster/logs" not in lines and ".thruster/logs/" not in lines:
        entries_to_add.append(".thruster/logs/")
    if ".thruster/crashes" not in lines and ".thruster/crashes/" not in lines:
        entries_to_add.append(".thruster/crashes/")

    if entries_to_add:
        try:
            with open(gitignore_path, "a", encoding="utf-8") as f:
                if existing and not existing.endswith("\n"):
                    f.write("\n")
                f.write("# Thruster logs\n" + "\n".join(entries_to_add) + "\n")
        except Exception:
            pass

def prune_logs(directory, max_count):
    try:
        if not os.path.isdir(directory):
            return
        files = [os.path.join(directory, f) for f in os.listdir(directory) if f.endswith(".log")]
        files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        for old_file in files[max_count:]:
            try:
                os.remove(old_file)
            except OSError:
                pass
    except Exception:
        pass

def read_stream_tokens(stream):
    """
    Read output character-by-character to split on both \r and \n immediately,
    avoiding line buffering delays from tools like esptool and avrdude.
    """
    buf = []
    while True:
        try:
            chunk = stream.read(1)
        except Exception:
            break
        if not chunk:
            if buf:
                yield "".join(buf)
            break
        if chunk in ("\r", "\n"):
            if buf:
                yield "".join(buf)
                buf = []
        else:
            buf.append(chunk)

def main():
    if len(sys.argv) < 3 or sys.argv[1] != "--job":
        print("Usage: flash_runner.py --job <job.json>", file=sys.stderr)
        sys.exit(1)

    job_file = sys.argv[2]
    if not os.path.exists(job_file):
        print(f"Error: Job file not found: {job_file}", file=sys.stderr)
        sys.exit(1)

    with open(job_file, "r", encoding="utf-8") as f:
        job = json.load(f)

    cli_path = job.get("cliPath") or "arduino-cli"
    port = job.get("port")
    fqbn = job.get("fqbn")
    sketch_dir = job.get("sketchDir")
    workspace_dir = job.get("workspaceDir") or sketch_dir
    lock_file = job.get("lockFile")
    status_file = job.get("statusFile")
    max_logs = int(job.get("maxLogs", 10))
    max_crash_logs = int(job.get("maxCrashLogs", 10))
    memory = job.get("memory")
    do_monitor = bool(job.get("monitor", False))
    baud = job.get("baud", 115200)

    # 1. Print Header
    print(f"\033[1;36m=== Thruster: Flashing (Uploading) to {port}... ===\033[0m")
    render_memory_banner(memory)

    # 2. Build Command
    cmd = [cli_path, "upload", "-p", port, "--fqbn", fqbn, sketch_dir]

    start_time = time.time()
    all_output_lines = []
    current_pct = 0
    render_progress_bar(0, 0, "Connecting...")

    # Pattern matchers for percentage
    pct_patterns = [
        re.compile(r"Writing at 0x[0-9a-fA-F]+\.\.\.\s*\(([0-9]+)\s*%\)"), # esptool
        re.compile(r"([0-9]{1,3})%"),                                       # generic / avrdude
        re.compile(r"([0-9]+)\s*/\s*([0-9]+)\s*bytes")                     # byte counts
    ]

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1
        )

        for line in read_stream_tokens(proc.stdout):
            cleaned = line.strip()
            if not cleaned:
                continue
            all_output_lines.append(cleaned)
            elapsed = time.time() - start_time

            # Check percentage
            found_pct = None
            for pat in pct_patterns:
                m = pat.search(cleaned)
                if m:
                    if len(m.groups()) == 1:
                        found_pct = int(m.group(1))
                        break
                    elif len(m.groups()) == 2:
                        try:
                            n1 = int(m.group(1))
                            n2 = int(m.group(2))
                            if n2 > 0:
                                found_pct = int((n1 / n2) * 100)
                                break
                        except ValueError:
                            pass

            if found_pct is not None:
                current_pct = max(current_pct, found_pct)
                render_progress_bar(current_pct, elapsed)
            else:
                # Show status preview if interesting
                low = cleaned.lower()
                status_hint = ""
                if "connecting" in low:
                    status_hint = "Connecting..."
                elif "chip is" in low:
                    status_hint = cleaned
                elif "erasing" in low:
                    status_hint = "Erasing flash..."
                elif "compressed" in low:
                    status_hint = "Compressing..."
                elif "verifying" in low or "hash of data verified" in low:
                    status_hint = "Verifying..."
                
                if status_hint:
                    render_progress_bar(current_pct, elapsed, status_hint)

        proc.wait()
        exit_code = proc.returncode
    except Exception as e:
        exit_code = 1
        all_output_lines.append(f"Runner Exception: {str(e)}")

    total_time = time.time() - start_time

    # 3. Setup .thruster folders
    thruster_dir = os.path.join(workspace_dir, ".thruster")
    logs_dir = os.path.join(thruster_dir, "logs")
    crashes_dir = os.path.join(thruster_dir, "crashes")

    os.makedirs(logs_dir, exist_ok=True)
    os.makedirs(crashes_dir, exist_ok=True)

    ensure_gitignore(workspace_dir)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    full_output_text = "\n".join(all_output_lines)

    # 4. Handle Success or Failure
    if exit_code == 0:
        render_progress_bar(100, total_time, "Done!")
        sys.stdout.write("\n")
        print(f"\033[1;32m✔ Flash Succeeded!\033[0m \033[0;90m(Total time: {total_time:.2f}s)\033[0m")
        
        # Write normal log
        log_filename = f"flash_{timestamp}.log"
        log_path = os.path.join(logs_dir, log_filename)
        rel_log_path = os.path.join(".thruster", "logs", log_filename)
        
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"======================================================================\n")
            f.write(f"Thruster Flash Log: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Target Board: {fqbn}\n")
            f.write(f"Serial Port:  {port}\n")
            f.write(f"Result:       SUCCESS (Exit Code: 0)\n")
            f.write(f"Duration:     {total_time:.2f}s\n")
            f.write(f"======================================================================\n\n")
            if memory:
                f.write("Memory Usage:\n")
                if memory.get("flash"):
                    f.write(f"  Program Storage (Flash): {format_bytes(memory['flash'].get('used'))} / {format_bytes(memory['flash'].get('max'))} ({memory['flash'].get('percent')}%)\n")
                if memory.get("ram"):
                    f.write(f"  Dynamic Memory (RAM):    {format_bytes(memory['ram'].get('used'))} / {format_bytes(memory['ram'].get('max'))} ({memory['ram'].get('percent')}%)\n")
                f.write("\n======================================================================\n\n")
            f.write("Detailed Command Output:\n")
            f.write(full_output_text)
            f.write("\n")

        prune_logs(logs_dir, max_logs)
        print(f"\033[0;36m📁 Detailed log saved to: {rel_log_path}\033[0m\n")

        if status_file:
            try:
                with open(status_file, "w", encoding="utf-8") as f:
                    f.write("0")
            except Exception:
                pass
    else:
        sys.stdout.write("\n")
        print(f"\033[1;31m❌ Flash Failed! (Exit code: {exit_code})\033[0m")

        # Extract last few meaningful error lines to display in terminal
        err_lines = [l for l in all_output_lines if any(k in l.lower() for k in ("error", "failed", "fatal", "denied", "timed out", "cannot open", "no such"))]
        if err_lines:
            print("\033[0;31m" + "\n".join(err_lines[-4:]) + "\033[0m")

        # Write crash log
        crash_filename = f"crash_{timestamp}.log"
        crash_path = os.path.join(crashes_dir, crash_filename)
        rel_crash_path = os.path.join(".thruster", "crashes", crash_filename)

        with open(crash_path, "w", encoding="utf-8") as f:
            f.write(f"======================================================================\n")
            f.write(f"Thruster Flash Crash Log: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Target Board: {fqbn}\n")
            f.write(f"Serial Port:  {port}\n")
            f.write(f"Result:       FAILED (Exit Code: {exit_code})\n")
            f.write(f"Duration:     {total_time:.2f}s\n")
            f.write(f"======================================================================\n\n")
            f.write("Detailed Command Output:\n")
            f.write(full_output_text)
            f.write("\n")

        prune_logs(crashes_dir, max_crash_logs)
        print(f"\033[0;31m📁 Crash log saved to: {rel_crash_path}\033[0m\n")

        if status_file:
            try:
                with open(status_file, "w", encoding="utf-8") as f:
                    f.write("1")
            except Exception:
                pass

    # 5. Release Lock
    if lock_file and os.path.exists(lock_file):
        try:
            os.remove(lock_file)
        except Exception:
            pass

    # Clean up temp job file
    try:
        os.remove(job_file)
    except Exception:
        pass

    # 6. Launch Monitor if requested and successful
    if exit_code == 0 and do_monitor:
        print(f"\033[1;32m=== Thruster Serial Monitor ({port} @ {baud} bps) - Press Ctrl+C to exit ===\033[0m")
        try:
            # Use os.execvp so monitor takes over the terminal process smoothly
            os.execvp(cli_path, [cli_path, "monitor", "-p", port, "-c", f"baudrate={baud}"])
        except Exception:
            subprocess.run([cli_path, "monitor", "-p", port, "-c", f"baudrate={baud}"])

if __name__ == "__main__":
    main()
