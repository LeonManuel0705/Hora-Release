# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import importlib.util
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("check_macos_minimum", ROOT / "scripts" / "check_macos_minimum.py")
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def thin(major, minor=0, old_style=False):
    packed = (major << 16) | (minor << 8)
    command = struct.pack("<IIII", 0x24, 16, packed, packed) if old_style else struct.pack("<IIIIII", 0x32, 24, 1, packed, packed, 0)
    return struct.pack("<IiiIIIII", 0xFEEDFACF, 0x0100000C, 0, 6, 1, len(command), 0, 0) + command


def fat(*slices):
    header = struct.pack(">II", 0xCAFEBABE, len(slices))
    offset, entries, body = 4096, b"", b""
    for data in slices:
        entries += struct.pack(">iiIII", 0x0100000C, 0, offset, len(data), 12)
        body += data.ljust(4096, b"\0")
        offset += 4096
    return (header + entries).ljust(4096, b"\0") + body


def test_the_minimum_is_read_from_every_kind_of_mach_o(tmp_path):
    files = {"new.so": thin(14), "old.dylib": thin(11), "legacy.so": thin(10, 13, old_style=True), "fat.so": fat(thin(10, 9), thin(12)), "text.py": b"print()\n"}
    for name, data in files.items():
        (tmp_path / name).write_bytes(data)
    assert check.minimums(tmp_path / "new.so") == [(14, 0)]
    assert check.minimums(tmp_path / "legacy.so") == [(10, 13)]
    assert check.minimums(tmp_path / "fat.so") == [(10, 9), (12, 0)]
    assert check.minimums(tmp_path / "text.py") == []
    assert check.main([str(tmp_path), "11.0"]) == 1
    (tmp_path / "new.so").unlink()
    (tmp_path / "fat.so").unlink()
    assert check.main([str(tmp_path), "11.0"]) == 0


def test_a_package_with_a_too_new_file_is_named_for_the_swap(tmp_path, capsys):
    (tmp_path / "numpy").mkdir()
    (tmp_path / "numpy" / "core.so").write_bytes(thin(14))
    (tmp_path / "flask").mkdir()
    (tmp_path / "flask" / "app.py").write_text("x = 1\n")
    for name, version, listed in [("numpy", "2.4.6", "numpy/core.so"), ("Flask", "3.1.2", "flask/app.py")]:
        info = tmp_path / f"{name}-{version}.dist-info"
        info.mkdir()
        (info / "METADATA").write_text(f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n\nBody: ignored\n")
        (info / "RECORD").write_text(f"{listed},sha256=x,1\n{info.name}/METADATA,,\n")
    assert check.main(["--packages", str(tmp_path), "11.0"]) == 0
    assert capsys.readouterr().out.split() == ["numpy==2.4.6"]
