# Security and data-privacy reporting

## Reporting a software vulnerability

If you find a vulnerability in this application's code (for example, an
authentication/authorization bypass, an injection issue, or a way to read
or write data you shouldn't be able to), please report it privately rather
than opening a public issue: **zuduo.zheng@uq.edu.au**.

Please include enough detail to reproduce the issue. We don't currently
operate a bug-bounty program or commit to a specific response-time
guarantee, but reports are read and taken seriously.

## Reporting a data or privacy concern about an indexed record

White Box Autonomy indexes publicly available evidence about
automated-driving events. If you believe a specific record:

- contains information that shouldn't be public,
- misrepresents its source material, or
- raises a privacy concern about an individual,

please contact **zuduo.zheng@uq.edu.au** with a link to the record and a
description of the concern. See the live site's
[Privacy](https://whiteboxautonomy.org/privacy) page for how submitted
information is generally handled.

## Reporting an accidentally exposed secret

This repository is not expected to contain any credential or secret (see
`.env.example` for what configuration is expected, and note that a
Supabase service-role key should never be part of this project). If you
believe one has been exposed anywhere in this repository or its history,
please report it to **zuduo.zheng@uq.edu.au** rather than opening a public
issue.
