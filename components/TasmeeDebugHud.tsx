import React, { memo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  visible: boolean;
  onClose: () => void;
  onToggleOverlay?: () => void;
  overlayEnabled?: boolean;
  debug: {
    audio?: {
      lastLevelDb: number | null;
      noiseFloorDb: number | null;
      effectiveSpeechLevelDbThreshold: number;
    };
    lastLocalActivity?: {
      seq: number;
      hasSpeech: boolean | null;
      levelDb: number | null;
      timestampMs: number;
    } | null;
    lastDeltaEvent?: unknown;
    lastStatusEvent?: unknown;
  };
};

const formatNumber = (value: number | null | undefined, digits = 1) => {
  if (value == null || !Number.isFinite(value)) return "null";
  return value.toFixed(digits);
};

function TasmeeDebugHud({
  visible,
  onClose,
  onToggleOverlay,
  overlayEnabled,
  debug,
}: Props) {
  if (!visible) return null;

  const audio = debug.audio;
  const local = debug.lastLocalActivity;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Tasmee Debug</Text>
          <View style={styles.actions}>
            {onToggleOverlay ? (
              <Pressable onPress={onToggleOverlay} style={styles.button}>
                <Text style={styles.buttonText}>
                  {overlayEnabled ? "Overlay: on" : "Overlay: off"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} style={styles.button}>
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.kv}>
            audio.lastLevelDb={formatNumber(audio?.lastLevelDb)}{" "}
            audio.noiseFloorDb={formatNumber(audio?.noiseFloorDb)}{" "}
            audio.thresholdDb={formatNumber(audio?.effectiveSpeechLevelDbThreshold)}
          </Text>
          <Text style={styles.kv}>
            local.seq={local?.seq ?? "null"} local.hasSpeech=
            {local?.hasSpeech ?? "null"} local.levelDb={formatNumber(local?.levelDb)}
          </Text>

          <Text style={styles.section}>last session.status</Text>
          <Text style={styles.json}>{JSON.stringify(debug.lastStatusEvent, null, 2)}</Text>

          <Text style={styles.section}>last feedback.delta</Text>
          <Text style={styles.json}>{JSON.stringify(debug.lastDeltaEvent, null, 2)}</Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    maxHeight: "55%",
    borderRadius: 12,
    backgroundColor: "rgba(10, 10, 10, 0.88)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    padding: 10,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  button: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  scroll: {
    marginTop: 10,
  },
  scrollContent: {
    paddingBottom: 10,
  },
  kv: {
    color: "#DDE7EE",
    fontSize: 12,
    fontFamily: "Courier",
    marginBottom: 6,
  },
  section: {
    marginTop: 10,
    marginBottom: 4,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  json: {
    color: "#CFE7FF",
    fontSize: 11,
    fontFamily: "Courier",
  },
});

export default memo(TasmeeDebugHud);

