// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import 'local_llm.dart';

bool runtimeAvailable() => false;

bool prefersGpu() => false;

LocalLlm createLocalLlm() => throw UnsupportedError('No on-device model on this platform');
