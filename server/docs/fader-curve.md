# RME fader curve: dB <-> faderlin

Verbatim from the "Fader curve" sheet of `OSCProtocoll_260626.xls` (TotalMix
FX 2.1 alpha 8 "Global OSC"). This is RME's own conversion between the
`faderlin` wire value (0..1 fader position) and dB. The Excel sheet is the
only source for this code; neither PDF export of the spec contains it, which
is why it is preserved here.

The MCP server itself does **no** conversion (dumb-pipe design). The skills
avoid `faderlin` entirely and use the dB-native addresses instead
(`/mix/.../fader`, `/output/<n>/volume`). Keep this reference for the rare
case a cached `faderlin` value has to be interpreted, or for verifying what
a given position means.

Curve shape: linear region from fader position 649/1023 upward
(`dB = pos * 0.0320855615 - 26.8235294118`, i.e. about -6 dB and above),
quadratic below, floor at -65 dB which maps to "off" (`GAINSUBMIXOFF`,
-300 dB on the wire).

```c
float CalcFaderDB(float inValue)
{
    float faderPos = inValue * 1023.0f;
    float dBValue;
    if (faderPos >= 649.0f)
        dBValue = faderPos * 0.0320855615f - 26.8235294118f;
    else
        dBValue = (faderPos * faderPos) * (-1.0f / 11033.0f)
                  + faderPos * 0.1497326203f - 65.0f;
    if (dBValue < -64.9f)
        dBValue = GAINSUBMIXOFF;
    return dBValue;
}

float CalcFaderLin(float inValueDB)
{
    float faderPos;
    if (inValueDB >= -6.0f)
        faderPos = (inValueDB + 26.8235294118f) * (1.0f / 0.0320855615f);
    else
        faderPos = 826.0f - sqrtf(-34869.0f - 11033.0f * inValueDB);
    return __minmax(0.0f, faderPos * (1.0f / 1023.0f), 1.0f);
}
```
