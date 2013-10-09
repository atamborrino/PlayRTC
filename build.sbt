name := "playrtc"

organization := "com.github.atamborrino"

version := "0.1-SNAPSHOT"
 
scalaVersion := "2.10.2"
 
resolvers ++= Seq(
	"TypesafeRepo repository" at "http://repo.typesafe.com/typesafe/releases/"
)
 
libraryDependencies ++= Seq(
	"com.typesafe.play"  %% "play" % "2.2.0" % "provided"
)
