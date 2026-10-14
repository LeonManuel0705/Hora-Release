# Contributing

Contributions are welcome. Two things are worth knowing first: what you may do
with Hora's code, and what has to happen before a pull request can be merged.

## Using the code

Hora is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). That
holds for the whole project, for changed versions of it and for every part of
the code you take from it, however small.

- You may use, study and change Hora for any noncommercial purpose. Private use
  is fine, and so is use by a school or a school authority.
- If you pass Hora on, changed or not, whole or in part, you pass it on free of
  charge, together with the license and the `Required Notice` line from
  [LICENSE](LICENSE).
- You may not earn money with Hora or with any part of its code. Selling it,
  charging for access to it or for hosting it, building it into a paid product
  and running it with ads all need a commercial license from the copyright
  holder. See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

The LICENSE file is the binding text. If you are not sure whether something you
plan counts as commercial, ask before you start.

## Sign the CLA

Hora is dual licensed: the PolyForm Noncommercial License for everyone, and a
commercial license for anyone who wants to earn money with it. That model only
works while one person holds the rights to all of the code.

So every contributor signs the [Contributor License Agreement](licensing/CLA.md).
You keep the copyright to your work. You grant a license wide enough that your
code can ship under both licenses.

Signing is one line added to [licensing/contributors.md](licensing/contributors.md)
in the same pull request as your first contribution. Contributors under 18 need a
parent or guardian to co-sign, which the CLA explains.

Without that line the pull request cannot be merged, however good the code is.

## Before you open a pull request

- Run the tests: `python -m pytest tests/ -v` for the backend,
  `flutter test` in `flutter_app/`
- Build the web target if you touched anything under `flutter_app/lib/services/`:
  `flutter build web`
- Keep `database_service.dart` and `database_service_web.dart` in sync. They are
  two halves of one conditional import, and the web half is not type checked
  until a web build runs. A signature that exists in one and not the other breaks
  CI and nothing else catches it.
- New source files carry the two line SPDX header used everywhere else in the
  repository.
- Only add third party code under a permissive license such as MIT, BSD or
  Apache-2.0, and say in the pull request where it comes from. Code under the
  GPL, the AGPL or another copyleft license cannot go into Hora.

## Reporting something

Bugs and feature requests go in the issue tracker. Security problems do not. For
those, write privately to the address in the repository profile rather than
opening an issue.
