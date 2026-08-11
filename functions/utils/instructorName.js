function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function instructorDetails(db, value) {
  const instructorId = cleanString(value);
  if (!instructorId) return { instructorId: "", instructor: "" };
  const snapshot = await db.collection("instructors").doc(instructorId).get();
  return {
    instructorId,
    instructor: snapshot.exists ? cleanString(snapshot.data()?.name) || instructorId : instructorId,
  };
}
