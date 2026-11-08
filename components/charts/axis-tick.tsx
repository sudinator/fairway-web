"use client";
import React from "react";
import { Text } from "recharts";
import { C } from "@/lib/golf";

// Keep Recharts' collision selection and vertical alignment. A tiny inward shift
// protects endpoint glyphs when SVG and DOM text measurements round differently.
export function ChartAxisTick({ x, y, payload, index, visibleTicksCount, tickFormatter, textAnchor, verticalAnchor }: any) {
  const inset = visibleTicksCount > 1 ? (index === 0 ? 2 : index === visibleTicksCount - 1 ? -2 : 0) : 0;
  return <Text x={x + inset} y={y} fontSize={11} fill={C.sage} textAnchor={textAnchor} verticalAnchor={verticalAnchor}>{tickFormatter ? tickFormatter(payload.value, index) : payload.value}</Text>;
}
