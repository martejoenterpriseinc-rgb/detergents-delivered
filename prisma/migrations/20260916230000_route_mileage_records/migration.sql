ALTER TABLE "Route" ADD COLUMN "mileageVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MileageTrip"
 ADD COLUMN "routeLegId" TEXT,
 ADD COLUMN "startOdometerPrecise" DECIMAL(12,2),
 ADD COLUMN "endOdometerPrecise" DECIMAL(12,2);
CREATE UNIQUE INDEX "MileageTrip_routeLegId_key" ON "MileageTrip"("routeLegId");
ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_routeLegId_fkey"
 FOREIGN KEY ("routeLegId") REFERENCES "RouteLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_mileageVersion_valid" CHECK ("mileageVersion" >= 0);
ALTER TABLE "MileageTrip" ADD CONSTRAINT "MileageTrip_precise_valid" CHECK (
 ("routeLegId" IS NULL AND "startOdometerPrecise" IS NULL AND "endOdometerPrecise" IS NULL)
 OR ("routeLegId" IS NOT NULL AND "routeId" IS NOT NULL AND "startOdometerPrecise" IS NOT NULL
 AND "endOdometerPrecise" IS NOT NULL AND "startOdometer" IS NULL AND "endOdometer" IS NULL
 AND "startOdometerPrecise" >= 0 AND "endOdometerPrecise" >= "startOdometerPrecise"
 AND "miles" IS NOT NULL AND "miles" = "endOdometerPrecise" - "startOdometerPrecise")
);
