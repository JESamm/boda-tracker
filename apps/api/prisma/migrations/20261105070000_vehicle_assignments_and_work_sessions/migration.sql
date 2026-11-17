CREATE UNIQUE INDEX "VehicleAssignment_one_active_per_rider"
ON "VehicleAssignment" ("saccoId", "riderId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "VehicleAssignment_one_active_per_vehicle"
ON "VehicleAssignment" ("saccoId", "vehicleId")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "WorkSession_one_active_per_rider"
ON "WorkSession" ("saccoId", "riderId")
WHERE "status" = 'ACTIVE';
