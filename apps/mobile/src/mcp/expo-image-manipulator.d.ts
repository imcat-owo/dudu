declare module "expo-image-manipulator" {
  export function manipulateAsync(
    uri: string,
    actions: Array<{ resize?: { width?: number; height?: number } }>,
    options: { compress: number; format: "jpeg" | "png" },
  ): Promise<{ uri: string; width: number; height: number }>;
}
