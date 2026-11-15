// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import create from "./create.js";
import code from "./code.js";
import success from "./success.js";
import signin from "./signin.js";
import forgot from "./forgot.js";
import reset from "./reset.js";
import unlock from "./unlock.js";
import guest from "./guest.js";
import name from "./name.js";
import remove from "./delete.js";

export const SCREENS = { create, code, success, signin, forgot, reset, unlock, guest, name, delete: remove };
